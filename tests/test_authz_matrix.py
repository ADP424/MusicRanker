"""Authorization, checked against every route the app has, so a new endpoint is
covered the moment it's registered:

* a non-member gets 404 from every guild route (we don't confirm a guild exists);
* a role without a route's required capability gets 403;
* calling one's *own* guild's routes with *another* guild's ids never changes
  the other guild's rows, and never returns them;
* nothing returns a 500.
"""
from __future__ import annotations

import enum
import re
import typing

import pytest
from fastapi.routing import APIRoute
from pydantic import TypeAdapter

from server.authz import ROLE_CAPS
from server.database_models import GuildMember
from server.database_models.guild_role import GuildRole
from server.main import app

from .seed import IDS, MARKER, enum_value, fingerprint, seed_guild
from .seed import failures as seed_failures

BODY_MARKER = "bodyval"
#: Routes that end the caller's membership run last, or everything after them 404s.
_LAST = ("/transfer-ownership", "/leave")


def _routes() -> list[tuple[APIRoute, str]]:
    out = []
    for r in app.routes:
        if isinstance(r, APIRoute):
            for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
                out.append((r, m))

    def order(item):
        r, m = item
        return (r.path.endswith(_LAST), r.path == "/guilds/{guild_id}" and m == "DELETE")

    return sorted(out, key=order)


def _walk(dependant):
    for sub in dependant.dependencies:
        yield sub
        yield from _walk(sub)


def _required_caps(route: APIRoute) -> frozenset:
    caps = frozenset()
    for sub in _walk(route.dependant):
        caps |= getattr(sub.call, "required_caps", frozenset())
    return caps


def _path_annotations(route: APIRoute) -> dict[str, typing.Any]:
    ann = {p.name: p.field_info.annotation for p in route.dependant.path_params}
    for sub in _walk(route.dependant):
        ann.update({p.name: p.field_info.annotation for p in sub.path_params})
    return ann


def _param_value(name: str, annotation, *, guild_id: int, user_id: int):
    if name == "guild_id":
        return guild_id
    if name in ("user_id",):
        return user_id
    origin = typing.get_origin(annotation)
    if origin is typing.Literal:
        return typing.get_args(annotation)[0]
    if isinstance(annotation, type) and issubclass(annotation, enum.Enum):
        return enum_value(list(annotation))
    if annotation is int:
        return IDS[1] if name in ("b", "parent_id") else IDS[0]
    return "x"


def _example(schema: dict, defs: dict):
    """A plausible instance of a JSON schema, preferring the foreign guild's ids."""
    if "$ref" in schema:
        return _example(defs[schema["$ref"].split("/")[-1]], defs)
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return enum_value(schema["enum"])
    for key in ("anyOf", "oneOf", "allOf"):
        if key in schema:
            options = [s for s in schema[key] if s.get("type") != "null"] or schema[key]
            return _example(options[0], defs)
    t = schema.get("type")
    if t == "object":
        props = schema.get("properties", {})
        return {k: _example(v, defs) for k, v in props.items()}
    if t == "array":
        return [_example(schema.get("items", {}), defs)]
    if t == "integer":
        return IDS[0]
    if t == "number":
        return 1
    if t == "boolean":
        return True
    if t == "string":
        fmt = schema.get("format")
        if fmt == "email":
            return "nobody@example.com"
        if fmt in ("uri", "url"):
            return "https://example.com/" + BODY_MARKER
        return BODY_MARKER
    return None


def _body(route: APIRoute):
    if route.body_field is None:
        return None
    schema = TypeAdapter(route.body_field.field_info.annotation).json_schema()
    return _example(schema, schema.get("$defs", {}))


def _query_value(param, user_id: int):
    """A plausible value for a query parameter: a member for user ids, the
    first choice of a Literal, else something of the right type."""
    if param.name in ("user_id", "other"):
        return user_id
    ann = param.field_info.annotation
    if typing.get_origin(ann) is typing.Literal:
        return typing.get_args(ann)[0]
    return 1 if ann is int else MARKER


def _call(client, route: APIRoute, method: str, *, guild_id: int, user_id: int):
    ann = _path_annotations(route)
    names = re.findall(r"{(\w+)}", route.path)
    path = route.path
    for n in names:
        path = path.replace("{" + n + "}", str(_param_value(n, ann.get(n), guild_id=guild_id, user_id=user_id)))
    query = {p.name: _query_value(p, user_id) for p in route.dependant.query_params
             if p.name in ("user_id", "other") or p.field_info.is_required()}
    body = _body(route) if method in ("POST", "PUT", "PATCH") else None
    return client.request(method, path, params=query, json=body)


def _is_guild_route(route: APIRoute) -> bool:
    return "{guild_id}" in route.path


@pytest.fixture
def two_guilds(make_user, conn):
    """Alice owns guild A, filled with one of everything; Bob owns empty guild B."""
    alice, alice_id, guild_a = make_user("alice")
    bob, bob_id, guild_b = make_user("bob")
    seeded = seed_guild(conn, guild_a, alice_id)
    return dict(alice=alice, alice_id=alice_id, guild_a=guild_a,
                bob=bob, bob_id=bob_id, guild_b=guild_b, seeded=seeded)


def test_seed_covers_every_guild_table(two_guilds):
    from server.database_models import Base

    tables = {t.name for t in Base.metadata.sorted_tables if "guild_id" in t.c} - {"guild_members"}
    missing = tables - set(two_guilds["seeded"])
    detail = "\n".join(f"{t}: {seed_failures.get(t)}" for t in sorted(missing))
    assert not missing, f"seed couldn't populate:\n{detail}"


def test_non_member_gets_404_everywhere(two_guilds):
    bob, guild_a, alice_id = two_guilds["bob"], two_guilds["guild_a"], two_guilds["alice_id"]
    wrong = []
    for route, method in _routes():
        if not _is_guild_route(route):
            continue
        r = _call(bob, route, method, guild_id=guild_a, user_id=alice_id)
        if r.status_code != 404:
            wrong.append(f"{method} {route.path} -> {r.status_code}")
    assert not wrong, "non-member not refused with 404:\n" + "\n".join(wrong)


@pytest.mark.parametrize("role", [r for r in GuildRole if r is not GuildRole.owner])
def test_missing_capability_gets_403(two_guilds, make_user, session, role):
    guild_a, alice_id = two_guilds["guild_a"], two_guilds["alice_id"]
    carol, carol_id, _ = make_user("carol")
    session.add(GuildMember(guild_id=guild_a, user_id=carol_id, role=role))
    session.commit()
    have = ROLE_CAPS[role]
    wrong = []
    for route, method in _routes():
        if not _is_guild_route(route):
            continue
        need = _required_caps(route)
        if need <= have:
            continue
        r = _call(carol, route, method, guild_id=guild_a, user_id=alice_id)
        if r.status_code != 403:
            wrong.append(f"{method} {route.path} needs {sorted(c.value for c in need - have)} -> {r.status_code}")
    assert not wrong, f"{role.value} not refused with 403:\n" + "\n".join(wrong)


def test_foreign_ids_never_touch_or_leak_another_guild(two_guilds, conn):
    """Bob, owner of B, calls every route on B (and every non-guild route) using
    A's ids. A must come out byte-for-byte unchanged, and no response may carry
    A's data."""
    bob, guild_a, guild_b, alice_id = (
        two_guilds["bob"], two_guilds["guild_a"], two_guilds["guild_b"], two_guilds["alice_id"]
    )
    before = fingerprint(conn, guild_a)
    leaks, errors = [], []
    for route, method in _routes():
        if not (_is_guild_route(route) or "{" in route.path):
            continue
        r = _call(bob, route, method, guild_id=guild_b, user_id=alice_id)
        if r.status_code >= 500:
            errors.append(f"{method} {route.path} -> {r.status_code}")
        elif r.status_code < 300 and MARKER in r.text:
            leaks.append(f"{method} {route.path} -> {r.status_code}: {r.text[:200]}")
    after = fingerprint(conn, guild_a)
    changed = sorted(t for t in before if before[t] != after[t])
    assert not changed, f"guild A's rows changed by guild B's requests: {changed}"
    assert not leaks, "guild A's data returned to guild B:\n" + "\n".join(leaks)
    assert not errors, "server errors:\n" + "\n".join(errors)
