"""Turns the team's Earth Engine SMAP export into a small JSON the twin can show.

Usage (from the repository root):
    python3 research/simulation/export_smap_reference.py

Reads   research/simulation/ANBIT_Saudi_SMAP_2024_14cities.csv  (if present)
Writes  frontend/lib/twin/smap.json

Monthly means of every valid AM and PM retrieval per city. Nothing is imputed:
a city-month without valid retrievals is simply absent. When the CSV is missing
the JSON says so and the twin hides the reference.
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "research/simulation/ANBIT_Saudi_SMAP_2024_14cities.csv"
OUT = ROOT / "frontend/lib/twin/smap.json"
COLUMNS = {"date_utc", "city", "vwc_am_fraction", "vwc_pm_fraction", "origin", "grid_resolution_m"}


def main():
    if not SOURCE.exists():
        OUT.write_text(json.dumps({"available": False}) + "\n", encoding="utf-8")
        print(f"{SOURCE.name} not found; wrote available=false")
        return
    sums = defaultdict(float)
    counts = defaultdict(int)
    years = set()
    with SOURCE.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        missing = COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"CSV columns missing: {sorted(missing)}")
        for row in reader:
            if row["origin"] != "NASA_SMAP_L3_SATELLITE_RETRIEVAL" or row["grid_resolution_m"] != "9000":
                continue
            year, month = row["date_utc"][:4], int(row["date_utc"][5:7])
            for col in ("vwc_am_fraction", "vwc_pm_fraction"):
                if not row[col]:
                    continue
                value = float(row[col])
                if 0 <= value <= 1:
                    sums[(row["city"], month)] += value
                    counts[(row["city"], month)] += 1
                    years.add(year)
    cities = defaultdict(dict)
    for (city, month), total in sorted(sums.items()):
        cities[city][str(month)] = {"vwc": round(total / counts[(city, month)], 4), "n": counts[(city, month)]}
    OUT.write_text(
        json.dumps(
            {
                "available": True,
                "source": "NASA SMAP L3 Enhanced (SPL3SMP_E/006), quality flag 0, ~9 km grid; satellite surface retrieval, not in-situ",
                "years": sorted(years),
                "cities": cities,
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} for {len(cities)} cities")


if __name__ == "__main__":
    main()
