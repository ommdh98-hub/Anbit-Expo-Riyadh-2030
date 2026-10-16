"""Allowed irrigation windows, including windows that cross midnight.

The same case table is checked by frontend/tests/twin.test.mjs against the
Digital Twin's window.ts, so Home, Irrigation and the twin agree."""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlmodel import Session

from app import main
from app.engine import decide
from app.home import HomeInput, allowed_window, home_summary
from app.models import Zone
from app.window import hours_to_window_end, in_window, window_length
from test_api import client  # noqa: F401

FIXTURE = Path(__file__).resolve().parents[2] / "frontend/tests/fixtures/irrigation-windows.json"
RIYADH = timezone(timedelta(hours=3))


def test_shared_window_table():
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    assert {(c["start"], c["end"]) for c in cases} == {(18, 8), (22, 4), (4, 9)}
    for c in cases:
        assert in_window(c["hour"], c["start"], c["end"]) == c["inWindow"], c
        assert hours_to_window_end(c["hour"], c["start"], c["end"]) == pytest.approx(c["hoursToEnd"]), c
    assert (window_length(18, 8), window_length(22, 4), window_length(4, 9)) == (14, 6, 5)


@pytest.mark.parametrize("start,end", [(18, 8), (22, 4), (4, 9)])
def test_home_next_irrigation_falls_inside_the_window(client, start, end):  # noqa: F811
    with Session(main.engine) as session:
        zone = session.get(Zone, "z3")  # below its minimum: irrigation is due
        zone.allowed_start_hour, zone.allowed_end_hour = start, end
        points, readings, soil = main.zone_data(session, zone)
        decision = decide(zone, soil, points, readings)
        # After the seeded readings, so a current (or estimated) moisture exists.
        tomorrow = datetime.now(RIYADH) + timedelta(days=1)
        for hour in (2, 9, 13, 20):
            now = tomorrow.replace(hour=hour, minute=30, second=0, microsecond=0)
            result = home_summary(zone, soil, readings, decision, HomeInput(), now)
            assert (result["allowed_start_hour"], result["allowed_end_hour"]) == (start, end)
            at = datetime.fromisoformat(result["next_at"])
            assert in_window(at.hour, start, end), (start, end, hour, at)
            assert at >= now


def test_window_source_order():
    zone = Zone(id="w", site_id="s", name="n", plant_id="p", soil_id="s", x=0, y=0, width=1, height=1, area_m2=1, allowed_start_hour=18, allowed_end_hour=8)
    assert allowed_window(zone, HomeInput()) == (18, 8)
    assert allowed_window(zone, HomeInput(allowed_start_hour=4, allowed_end_hour=9)) == (4, 9)
    legacy = Zone(id="l", site_id="s", name="n", plant_id="p", soil_id="s", x=0, y=0, width=1, height=1, area_m2=1)
    assert allowed_window(legacy, HomeInput()) == (4, 9)
