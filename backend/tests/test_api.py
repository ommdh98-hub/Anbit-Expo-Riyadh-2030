from datetime import datetime, timezone, timedelta
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy.pool import StaticPool
from app import main
from app.auth import install_account
from app.models import Site, Zone, SoilMeasurement


@pytest.fixture
def client(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    monkeypatch.setattr(main, "engine", engine)
    # Explicit test scenario (dry, wet, conflicting and stale zones on the earlier,
    # larger areas). The real demo seed is tested in test_reference_and_migrations.
    monkeypatch.setenv("ANBIT_SEED_SCENARIO", "test")
    with TestClient(main.app) as c:
        install_account(engine, "user", "test-user-password", iterations=1000)
        install_account(engine, "survey", "test-survey-password", iterations=1000)
        c.headers.update({"X-Anbit-Request": "app"})
        as_role(c, "survey")
        yield c


def as_role(c, role):
    response = c.post("/api/auth/login", json={"username": role, "password": f"test-{role}-password"})
    assert response.status_code == 200, response.text
    return c


def reading(**overrides):
    return {
        "id": str(uuid4()),
        "x": 20,
        "y": 14,
        "value": 15,
        "unit": "vwc_percent",
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "source": "اختبار المحاكاة",
        "operator": "الفريق",
        "quality": "verified",
        "origin": "simulation",
        **overrides,
    }


def test_scenarios(client):
    assert client.get("/api/health").json()["database"] == "connected"
    zones = client.get("/api/zones").json()
    assert [z["decision"]["code"] for z in zones] == [
        "measure",
        "high",
        "review",
        "conflict",
        "insufficient",
    ]
    # z3 bougainvillea on loam (reference DB): 400 m² × 0.5 m × (0.255 − 0.16) × 1000 ÷ 0.9
    assert zones[2]["decision"]["estimate"]["gross_l"] == 21111.1
    for z in zones:
        p = z["decision"]["coverage"]["next_point"]
        assert z["x"] <= p["x"] <= z["x"] + z["width"]
        assert z["y"] <= p["y"] <= z["y"] + z["height"]


def test_measurement_journey(client):
    as_role(client, "survey")
    first = client.get("/api/zones/z1").json()
    for _ in range(10):
        z = client.get("/api/zones/z1").json()
        if z["decision"]["code"] == "review":
            break
        p = z["decision"]["coverage"]["next_point"]
        # z1 is sand (field capacity 10%): a dry reading there is about 6%.
        result = client.post(
            "/api/zones/z1/measurements", json=reading(x=p["x"], y=p["y"], value=6)
        )
        assert result.status_code == 201
    assert result.json()["decision"]["code"] == "review"
    assert len(result.json()["measurements"]) > len(first["measurements"])


@pytest.mark.parametrize(
    "overrides",
    [
        {"value": 101},
        {"unit": "air_humidity"},
        {"unit": "vwc_fraction", "value": 1.1},
        {"x": 1000},
        {"origin": "field", "evidence": "ref"},
        {"measured_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()},
        {"source": ""},
    ],
)
def test_invalid_readings(client, overrides):
    as_role(client, "survey")
    assert (
        client.post("/api/zones/z1/measurements", json=reading(**overrides)).status_code
        == 422
    )


def test_units_raw_and_duplicates(client):
    as_role(client, "survey")
    row = reading(point_id="z3-p1", value=0.16, unit="vwc_fraction")
    assert client.post("/api/zones/z3/measurements", json=row).status_code == 201
    assert client.post("/api/zones/z3/measurements", json=row).status_code == 409
    result = client.post(
        "/api/zones/z3/measurements",
        json=reading(point_id="z3-p1", value=800, unit="raw"),
    ).json()
    assert result["decision"]["mean_vwc"] == 0.16
    assert any("خام" in r["reason"] for r in result["decision"]["rejected"])


def test_operations(client):
    rec = client.post("/api/zones/z3/recommendations").json()
    assert client.post("/api/zones/z3/recommendations").json()["id"] == rec["id"]
    event = {
        "id": str(uuid4()),
        "recommendation_id": rec["id"],
        "volume": 1.25,
        "unit": "m3",
        "volume_kind": "measured",
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "operator": "الفريق",
    }
    assert client.post("/api/irrigation-events", json=event).status_code == 409
    assert (
        client.patch(
            f"/api/recommendations/{rec['id']}",
            json={"status": "approved", "operator": "المشرف"},
        ).status_code
        == 200
    )
    assert client.get("/api/reports/water").json()["total_l"] == 0
    event["executed_at"] = datetime.now(timezone.utc).isoformat()
    assert client.post("/api/irrigation-events", json=event).status_code == 201
    assert client.post("/api/irrigation-events", json=event).status_code == 409
    report = client.get("/api/reports/water").json()
    assert report["total_l"] == 1250
    assert report["measured_l"] == 1250
    assert client.get("/api/reports/water?origin=field").json()["total_l"] == 0
    assert client.get("/api/zones/z3").json()["decision"]["code"] == "insufficient"


def test_stale_recommendation(client):
    rec = client.post("/api/zones/z3/recommendations").json()
    as_role(client, "survey")
    client.post("/api/zones/z3/measurements", json=reading(point_id="z3-p1", value=17))
    as_role(client, "survey")
    assert (
        client.patch(
            f"/api/recommendations/{rec['id']}",
            json={"status": "approved", "operator": "المشرف"},
        ).status_code
        == 409
    )


def test_reset_preserves_operational_site(client, monkeypatch):
    monkeypatch.setenv("ANBIT_MAINTENANCE_TOKEN", "isolated-test-maintenance-token-32chars")
    with Session(main.engine) as s:
        s.add(Site(id="field-site", name="موقع فعلي", origin="field"))
        s.commit()
        s.add(
            Zone(
                id="field-zone",
                site_id="field-site",
                name="منطقة فعلية",
                plant_id="mint",
                soil_id="soil-1",
                x=0,
                y=0,
                width=10,
                height=10,
                area_m2=100,
                origin="field",
            )
        )
        s.commit()
    assert client.post("/api/demo/reset", headers={"X-Anbit-Maintenance-Key": "isolated-test-maintenance-token-32chars"}).status_code == 200
    assert client.get("/api/zones/field-zone").status_code == 200
    assert len(client.get("/api/zones").json()) == 5


def test_estimator_missing_inputs(client):
    r = client.post(
        "/api/zones/z3/estimate",
        json={
            "irrigated_area_m2": 200,
            "root_depth_m": 0.1,
            "efficiency": 0.5,
            "root_representative": True,
            "homogeneous": True,
        },
    ).json()
    # 200 m² × 0.1 m × (0.255 − 0.16) × 1000 ÷ 0.5
    assert r["estimate"]["gross_l"] == 3800
    r = client.post(
        "/api/zones/z3/estimate",
        json={
            "irrigated_area_m2": 200,
            "root_depth_m": 0.1,
            "efficiency": 0.5,
            "root_representative": False,
            "homogeneous": True,
        },
    ).json()
    assert r["estimate"] is None


def test_inspection_persists(client):
    as_role(client, "survey")
    r = client.post(
        "/api/zones/z1/inspections",
        json={"id": str(uuid4()), "notes": "فحص توزيع النقاط", "operator": "الفريق"},
    )
    assert r.status_code == 201
    assert len(client.get("/api/zones/z1/inspections").json()) == 1


def test_high_moisture_cannot_be_approved(client):
    rec = client.post("/api/zones/z2/recommendations").json()
    response = client.patch(
        f"/api/recommendations/{rec['id']}",
        json={"status": "approved", "operator": "المشرف"},
    )
    assert response.status_code == 422
    assert client.get("/api/reports/water").json()["total_l"] == 0


def test_one_additional_reading_changes_demo_decision(client):
    as_role(client, "survey")
    zone = client.get("/api/zones/z1").json()
    assert zone["decision"]["code"] == "measure"
    point = zone["decision"]["coverage"]["next_point"]
    result = client.post(
        "/api/zones/z1/measurements", json=reading(x=point["x"], y=point["y"], value=6)
    ).json()
    assert result["decision"]["code"] == "review"
    assert (
        result["decision"]["coverage"]["fraction"]
        > zone["decision"]["coverage"]["fraction"]
    )


def test_unverified_reading_not_used(client):
    as_role(client, "survey")
    payload = reading(point_id="z3-p1", quality="unverified")
    zone = client.post("/api/zones/z3/measurements", json=payload).json()
    assert payload["id"] not in zone["decision"]["readings_used"]
    assert any(r["id"] == payload["id"] for r in zone["decision"]["rejected"])
