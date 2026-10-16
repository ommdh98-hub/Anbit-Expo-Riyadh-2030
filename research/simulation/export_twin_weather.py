"""Exports 2025 daily weather for the Digital Twin's cities from the reference database.

Usage (from the repository root):
    python3 research/simulation/export_twin_weather.py

Reads   data/reference/ANBIT_reference_app.db  (read-only; filled by fetch_weather.py)
Writes  frontend/lib/twin/weather2025.json

The twin stays browser-only: it reads this bundled file, never the database.
Cities without reference weather (Jeddah, Dammam) are left out, not imputed.
"""

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/reference/ANBIT_reference_app.db"
OUT = ROOT / "frontend/lib/twin/weather2025.json"
YEAR = 2025
# Twin city id -> reference city name.
CITIES = {"riyadh": "Riyadh", "medina": "Medina", "tabuk": "Tabuk", "abha": "Abha"}


def main():
    con = sqlite3.connect(f"file:{SOURCE}?mode=ro", uri=True)
    out = {"available": True, "year": YEAR, "source": "Open-Meteo historical (ERA5 reanalysis), daily, Asia/Riyadh", "cities": {}}
    for key, name in CITIES.items():
        rows = con.execute(
            "SELECT w.date, w.et0_mm, w.tmax_c, w.tmin_c, w.rh_mean_pct, w.precip_mm FROM weather_daily w "
            "JOIN cities c USING (city_id) WHERE c.name_en = ? AND w.date LIKE ? ORDER BY w.date",
            (name, f"{YEAR}-%"),
        ).fetchall()
        if len(rows) != 365 or any(v is None for r in rows for v in r):
            raise SystemExit(f"{name}: expected 365 complete days, got {len(rows)}")
        monthly = con.execute(
            "SELECT m.month, m.et0_mm_day FROM city_climate_monthly m JOIN cities c USING (city_id) "
            "WHERE c.name_en = ? AND m.year = ? ORDER BY m.month",
            (name, YEAR),
        ).fetchall()
        if len(monthly) != 12:
            raise SystemExit(f"{name}: expected 12 monthly ET0 values, got {len(monthly)}")
        out["cities"][key] = {
            "first": rows[0][0],
            # Monthly mean ET0 (mm/day) from city_climate_monthly, for display in setup.
            "et0_monthly": [m[1] for m in monthly],
            "et0": [r[1] for r in rows],
            "tmax": [r[2] for r in rows],
            "tmin": [r[3] for r in rows],
            "rh": [r[4] for r in rows],
            "rain": [r[5] for r in rows],
        }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {list(out['cities'])}, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
