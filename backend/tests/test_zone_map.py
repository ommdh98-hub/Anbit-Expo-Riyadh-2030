"""Zone map on Home: demo valve-sector shapes, sensor points inside them, and the
suggested next point with the coverage after a reading there (engine.coverage)."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app import main
from app.engine import coverage, decide
from app.migrate import run_migrations
from app.models import MeasurementPoint, Zone
from app.seed import DEMO_COVERAGE_RADIUS_M, DEMO_LAYOUTS, TEST_LAYOUTS, seed_demo
from test_api import client  # noqa: F401
from test_role_workflows import reading


def demo_session(monkeypatch):
    monkeypatch.delenv("ANBIT_SEED_SCENARIO", raising=False)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    run_migrations(engine)
    session = Session(engine)
    seed_demo(session)
    return session


def inside(zone, x, y):
    return zone.x <= x <= zone.x + zone.width and zone.y <= y <= zone.y + zone.height


def test_demo_shapes_match_the_valve_sector_areas(monkeypatch):
    session = demo_session(monkeypatch)
    zones = session.exec(select(Zone).order_by(Zone.id)).all()
    assert [(z.width * z.height) for z in zones] == [150, 120, 80, 200, 100]
    assert [z.area_m2 for z in zones] == [150, 120, 80, 200, 100]
    # Palm walk and green walk are long, narrow strips.
    assert zones[1].width / zones[1].height >= 5 and zones[4].width / zones[4].height >= 5
    # Shapes do not overlap on the site map.
    for a in zones:
        for b in zones:
            if a.id < b.id:
                assert a.x + a.width <= b.x or b.x + b.width <= a.x or a.y + a.height <= b.y or b.y + b.height <= a.y, (a.id, b.id)
    assert all(z.coverage_radius_m == DEMO_COVERAGE_RADIUS_M == 4 for z in zones)
    for z in zones:
        points = session.exec(select(MeasurementPoint).where(MeasurementPoint.zone_id == z.id)).all()
        assert [p.id for p in points] == [f"{z.id}-p{j}" for j in range(1, len(points) + 1)]
        assert all(inside(z, p.x, p.y) for p in points), z.id
    session.close()


def test_suggested_point_is_inside_and_raises_coverage(monkeypatch):
    session = demo_session(monkeypatch)
    expected = {"z1": (0.765, 0.8675), "z2": (0.60, 0.6975), "z3": (1.0, 1.0), "z4": (0.76, 0.785), "z5": (0.0, 0.30)}
    for zone in session.exec(select(Zone).order_by(Zone.id)).all():
        points, readings, soil = main.zone_data(session, zone)
        cov = decide(zone, soil, points, readings)["coverage"]
        nxt = cov["next_point"]
        assert inside(zone, nxt["x"], nxt["y"]), zone.id
        assert (cov["fraction"], nxt["coverage_after"]) == pytest.approx(expected[zone.id]), zone.id
        if cov["fraction"] < 1:
            assert nxt["coverage_after"] > cov["fraction"], zone.id
        else:
            assert nxt["coverage_after"] == cov["fraction"] == 1
    session.close()


def test_presentation_case_still_holds_in_the_test_layout(client):  # noqa: F811
    """«76.5% → 86.75%»: المدخل الرئيسي in the test layout (30 × 20 m, 8 m radius, three points)."""
    assert TEST_LAYOUTS[0] == (4, 4, 30, 20)
    with Session(main.engine) as session:
        zone = session.get(Zone, "z1")
        assert zone.coverage_radius_m == 8
        points, readings, _ = main.zone_data(session, zone)
        cov = coverage(zone, points, readings, datetime.now(timezone.utc))
    assert cov["fraction"] == pytest.approx(0.765)
    assert cov["next_point"]["coverage_after"] == pytest.approx(0.8675)
    # Recording a reading at the suggested point gives the predicted coverage.
    p = cov["next_point"]
    result = client.post("/api/zones/z1/measurements", json=reading(x=p["x"], y=p["y"]))
    assert result.status_code == 201, result.text
    assert result.json()["decision"]["coverage"]["fraction"] == pytest.approx(0.8675)


def test_demo_layout_is_half_the_test_layout_for_the_main_entrance():
    # Same geometry at half scale (15 × 10 m with 4 m), so the same 76.5% → 86.75%.
    (x, y, w, h), (_, _, tw, th) = DEMO_LAYOUTS[0], TEST_LAYOUTS[0]
    assert (w * 2, h * 2) == (tw, th) and DEMO_COVERAGE_RADIUS_M * 2 == 8
