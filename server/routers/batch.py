"""Several writes as one transaction.

The entity forms save in steps: create or patch the entry, then link its people,
genres and links one request at a time. Sent through `POST /batch` those steps
either all happen or none do, so a failure halfway no longer leaves a
half-created entry behind (and retrying no longer makes a duplicate).

Each op is replayed through the app itself, with the caller's cookies and CSRF
token, so it gets exactly the auth, validation and guild checks it would get on
its own. They share one session (`database.batch_session`); the batch commits
after the last op, or rolls everything back at the first one that fails.

An op's path or body may use an earlier op's response: "{0.id}" is the `id` of
op 0's JSON response.
"""
from __future__ import annotations

import json
import re
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import database

router = APIRouter(tags=["batch"])

#: Routes that commit part-way or start background work can't join a batch.
_REFUSED = re.compile(r"import|-refresh|/jobs|/batch|/merge|/backfill|/auth/|/account")
_REF = re.compile(r"\{(\d+)\.(\w+)\}")


class Op(BaseModel):
    method: Literal["POST", "PUT", "PATCH", "DELETE"]
    path: str = Field(pattern=r"^/guilds/\d+/")
    body: Any = None


class BatchIn(BaseModel):
    ops: list[Op] = Field(min_length=1, max_length=300)


class BatchOut(BaseModel):
    results: list[Any]  # each op's JSON response (null for 204s)


def _resolve(text: str, results: list[Any]) -> str:
    def sub(m: re.Match) -> str:
        i, key = int(m.group(1)), m.group(2)
        if i >= len(results) or not isinstance(results[i], dict) or key not in results[i]:
            raise HTTPException(422, f"Nothing to fill in for {m.group(0)}")
        return str(results[i][key])
    return _REF.sub(sub, text)


@router.post("/batch", response_model=BatchOut)
async def batch(body: BatchIn, request: Request):
    for i, op in enumerate(body.ops):
        if _REFUSED.search(op.path):
            raise HTTPException(422, f"Op {i}: {op.path} can't be part of a batch")

    from ..main import app  # the app the ops are replayed through (not the /api mount)

    headers = {k: v for k, v in request.headers.items() if k.lower() in ("cookie", "x-csrf-token", "x-forwarded-for")}
    db = database.SessionLocal()
    token = database.batch_session.set(db)
    results: list[Any] = []
    try:
        transport = httpx.ASGITransport(app=app, client=request.client and (request.client.host, request.client.port))
        async with httpx.AsyncClient(transport=transport, base_url=f"{request.url.scheme}://{request.url.netloc}") as client:
            for i, op in enumerate(body.ops):
                path = _resolve(op.path, results)
                content = None if op.body is None else _resolve(json.dumps(op.body), results)
                r = await client.request(op.method, path, content=content, headers={
                    **headers, **({"content-type": "application/json"} if content is not None else {})})
                if r.status_code >= 400:
                    try:
                        detail = r.json().get("detail")
                    except ValueError:
                        detail = r.text
                    raise HTTPException(r.status_code, {"op": i, "path": path, "detail": detail})
                results.append(r.json() if r.content else None)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        database.batch_session.reset(token)
        db.close()
    return BatchOut(results=results)
