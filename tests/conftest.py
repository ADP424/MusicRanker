"""Test harness.

The whole suite runs in a scratch schema (`mr_test_<pid>`) of the app's own
database: the DB user needn't have CREATE DATABASE rights, and the connection's
search_path is pinned to that schema, so the real tables in `public` are never
visible (see `database_url(schema=...)`). The schema is built once by
`alembic upgrade head`, which also exercises the migrations, and dropped at the
end.

Each test runs inside one outer transaction that's rolled back afterwards; the
app's `get_database` sessions join it through savepoints, so their commits are
real to the code under test but vanish between tests.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

os.environ.setdefault("APP_ENV", "test")

from server import database, ratelimit  # noqa: E402
from server.database import database_url, get_database  # noqa: E402
from server.main import app  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = f"mr_test_{os.getpid()}"


def _admin_exec(sql: str) -> None:
    eng = create_engine(database_url(), isolation_level="AUTOCOMMIT")
    with eng.connect() as c:
        c.execute(text(sql))
    eng.dispose()


@pytest.fixture(scope="session")
def engine():
    _admin_exec(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
    _admin_exec(f'CREATE SCHEMA "{SCHEMA}"')
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.cmd_opts = type("Opts", (), {"x": [f"schema={SCHEMA}"]})()
    command.upgrade(cfg, "head")
    eng = create_engine(database_url(schema=SCHEMA))
    yield eng
    eng.dispose()
    _admin_exec(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')


@pytest.fixture
def conn(engine):
    """One connection + outer transaction per test, rolled back at the end."""
    connection = engine.connect()
    outer = connection.begin()
    factory = sessionmaker(
        bind=connection, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False,
    )
    event.listen(factory, "before_flush", database._sync_norms)

    def _get_database():
        if database.batch_session.get() is not None:
            yield from database.in_batch()
            return
        with factory() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    app.dependency_overrides[get_database] = _get_database
    saved = database.SessionLocal
    database.SessionLocal = factory  # code that opens its own sessions (jobs) joins too
    ratelimit._HITS.clear()
    try:
        yield connection
    finally:
        database.SessionLocal = saved
        app.dependency_overrides.pop(get_database, None)
        outer.rollback()
        connection.close()


@pytest.fixture
def session(conn) -> Session:
    """A session on the test's connection, for arranging and inspecting state."""
    s = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False)
    event.listen(s, "before_flush", database._sync_norms)
    yield s
    s.close()


class ApiClient(TestClient):
    """A TestClient that primes and echoes the CSRF cookie like the frontend does.
    https because the app's cookies are Secure outside dev."""

    def __init__(self):
        super().__init__(app, base_url="https://testserver")
        self.get("/nationalities")

    def request(self, method, url, **kw):
        token = self.cookies.get("csrftoken")
        if token:
            kw["headers"] = {**(kw.get("headers") or {}), "x-csrf-token": token}
        return super().request(method, url, **kw)


@pytest.fixture
def make_user(conn):
    """make_user("alice") -> (client logged in as alice, user id, personal guild id)."""

    def _make(username: str):
        client = ApiClient()
        r = client.post("/auth/register", json={
            "username": username, "email": f"{username}@example.com", "password": "correct horse battery",
        })
        assert r.status_code == 201, r.text
        guild_id = client.get("/guilds").json()[0]["id"]
        return client, r.json()["id"], guild_id

    return _make
