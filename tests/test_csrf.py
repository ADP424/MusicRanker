"""Double-submit CSRF: unsafe requests need the cookie echoed in the header."""
from __future__ import annotations

from fastapi.testclient import TestClient

from server.main import ORIGINS, app


def test_cookie_is_minted_on_first_get(conn):
    c = TestClient(app, base_url="https://testserver")
    assert "csrftoken" in c.get("/nationalities").cookies


def test_unsafe_request_without_token_is_refused_with_cors_headers(conn):
    c = TestClient(app, base_url="https://testserver")
    c.get("/nationalities")
    origin = ORIGINS[0]
    r = c.post("/auth/login", json={"identifier": "x", "password": "y"}, headers={"origin": origin})
    assert r.status_code == 403 and r.json()["detail"] == "CSRF check failed"
    # Inside CORS: the browser lets the page read why it was refused.
    assert r.headers.get("access-control-allow-origin") == origin


def test_mismatched_token_is_refused(conn):
    c = TestClient(app, base_url="https://testserver")
    c.get("/nationalities")
    r = c.post("/auth/login", json={"identifier": "x", "password": "y"}, headers={"x-csrf-token": "forged"})
    assert r.status_code == 403


def test_matching_token_passes(conn):
    c = TestClient(app, base_url="https://testserver")
    token = c.get("/nationalities").cookies["csrftoken"]
    r = c.post("/auth/login", json={"identifier": "nobody", "password": "wrong password"},
               headers={"x-csrf-token": token})
    assert r.status_code == 401  # got past CSRF to the login itself
