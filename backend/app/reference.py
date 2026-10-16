"""Read-only access to the ANBIT reference database (data/reference/ANBIT_reference_app.db).

Plant coefficients (FAO-56, University of Arizona AZ1195, UC 2018, WUCOLS), soil
limits (Hanson 2000) and 2025 daily weather (Open-Meteo, ERA5 reanalysis).
The connection is opened with mode=ro: the app can never write to it.
"""

import os
import sqlite3
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE_PATH = Path(os.getenv("ANBIT_REFERENCE_DB", ROOT / "data" / "reference" / "ANBIT_reference_app.db"))
WEATHER_YEAR = 2025
DEFAULT_CITY = "Riyadh"
# Share of monthly rain counted as effective, as in the reference view v_monthly_water_need.
EFFECTIVE_RAIN = 0.8
ET_SOURCE = "ET0 شهري 2025 — Open-Meteo"


def available() -> bool:
    return REFERENCE_PATH.exists()


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(f"file:{REFERENCE_PATH}?mode=ro", uri=True, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def _one(sql: str, params=()):
    if not available():
        return None
    with connect() as con:
        row = con.execute(sql, params).fetchone()
    return dict(row) if row else None


def plant_soil_target(plant_id: int, soil_class: str):
    return _one(
        "SELECT t.plant_id, p.name_ar, p.name_en, t.soil_class, t.root_zone_m, t.vwc_min, t.vwc_target, t.vwc_max, t.taw_mm, t.raw_mm, t.method "
        "FROM plant_soil_targets t JOIN plants p USING (plant_id) WHERE t.plant_id = ? AND t.soil_class = ?",
        (plant_id, soil_class),
    )


def soil(soil_class: str):
    return _one("SELECT soil_class, fc_vwc, wp_vwc, aw_vwc, source FROM soil_hydraulics WHERE soil_class = ?", (soil_class,))


def landscape_param(plant_id: int):
    return _one("SELECT * FROM landscape_params WHERE plant_id = ?", (plant_id,))


@lru_cache(maxsize=512)
def monthly_need(plant_id: int, month: int, city: str = DEFAULT_CITY, year: int = WEATHER_YEAR):
    """Daily need for a month: ET0 (monthly mean of daily values) × Kc − effective rain."""
    row = _one(
        "SELECT m.et0_mm_day, m.precip_mm, m.days, k.kc FROM city_climate_monthly m "
        "JOIN cities c USING (city_id) JOIN kc_monthly k ON k.month = m.month "
        "WHERE c.name_en = ? AND m.year = ? AND m.month = ? AND k.plant_id = ?",
        (city, year, month, plant_id),
    )
    if not row or row["et0_mm_day"] is None:
        return None
    etc = row["et0_mm_day"] * row["kc"]
    rain = (row["precip_mm"] or 0) * EFFECTIVE_RAIN / row["days"]
    return {
        "city": city,
        "year": year,
        "month": month,
        "et0_mm_day": row["et0_mm_day"],
        "kc": row["kc"],
        "etc_mm_day": round(etc, 3),
        "effective_rain_mm_day": round(rain, 3),
        "net_mm_day": round(max(etc - rain, 0), 3),
        "source": ET_SOURCE,
    }


def landscape_plants():
    if not available():
        return []
    with connect() as con:
        rows = con.execute(
            "SELECT p.plant_id, p.name_ar, p.name_en, p.use_case, l.category, l.kc_summer, l.kc_winter, "
            "l.root_zone_m, l.irrigation_method, l.wucols_class, l.sources "
            "FROM plants p JOIN landscape_params l USING (plant_id) "
            "WHERE p.use_case IN ('landscape', 'both') ORDER BY l.category, p.name_ar"
        ).fetchall()
    return [dict(r) for r in rows]
