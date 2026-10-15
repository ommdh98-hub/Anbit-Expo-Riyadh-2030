"""Permissions must be enforced by the API, not just the frontend."""
from test_api import client, as_role, reading
from app.auth import hash_password, verify_password


def test_pbkdf2_password_storage():
    stored = hash_password("correct-password", iterations=1000)
    assert "correct-password" not in stored
    assert verify_password("correct-password", stored)
    assert not verify_password("other-password", stored)
    assert not verify_password("correct-password", "broken")


def test_login_session_and_logout(client):
    as_role(client, "user")
    assert client.get("/api/auth/me").json()["role"] == "user"
    assert client.get("/api/zones").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/zones").status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"username": "user", "password": "incorrect"}).status_code == 401
    assert client.get("/api/health").status_code == 200
    as_role(client, "survey")
    assert client.get("/api/auth/me").json()["role"] == "survey"


def test_user_cannot_add_readings_or_inspections(client):
    as_role(client, "user")
    assert client.post("/api/zones/z3/measurements", json=reading(point_id="z3-p1")).status_code == 403
    assert client.post("/api/zones/z3/inspections", json={}).status_code == 403
    assert client.get("/api/zones/z3").status_code == 200


def test_landscape_can_measure_and_recommend_but_cannot_reset(client):
    as_role(client, "survey")
    response = client.post("/api/zones/z3/measurements", json=reading(point_id="z3-p1"))
    assert response.status_code == 201
    assert response.json()["measurements"][0]["operator"] == "فرق المسطحات الخضراء"
    assert client.post("/api/zones/z3/recommendations").status_code == 200
    assert client.post("/api/demo/reset").status_code == 403
    assert client.post("/api/irrigation-events", json={}).status_code == 422
    assert client.patch("/api/recommendations/not-real", json={}).status_code == 422
    assert client.get("/api/reports/water").status_code == 200


def test_cross_site_mutation_rejected(client):
    r = client.post("/api/demo/reset", headers={"Origin": "https://malicious.example"})
    assert r.status_code == 403
    r = client.post("/api/demo/reset", headers={"X-Anbit-Request": ""})
    assert r.status_code == 403
    assert client.get("/api/zones").status_code == 200


def test_invalid_cookie_rejected(client):
    client.cookies.clear()
    client.cookies.set("anbit_session", "fake-token", path="/")
    assert client.get("/api/zones").status_code == 401
