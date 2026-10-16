"""Fill weather_daily and city_climate_monthly in ANBIT_reference.db from Open-Meteo.

Source: Open-Meteo historical weather API (ERA5 reanalysis), free, no key.
Docs:   https://open-meteo.com/en/docs/historical-weather-api

Usage:
  python3 fetch_weather.py ANBIT_reference.db 2025
  python3 fetch_weather.py ANBIT_reference.db 2025 --from-json cache_dir   # offline re-run

Only the standard library is used. Raw API responses are cached as JSON next to
the database so the data can be audited and rebuilt without the network.
"""
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://archive-api.open-meteo.com/v1/archive"
CORE = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "wind_speed_10m_max",
        "shortwave_radiation_sum", "et0_fao_evapotranspiration"]
EXTRA = ["temperature_2m_mean", "relative_humidity_2m_mean"]


def request(lat, lon, year, variables):
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "start_date": f"{year}-01-01", "end_date": f"{year}-12-31",
        "daily": ",".join(variables), "timezone": "Asia/Riyadh", "wind_speed_unit": "ms",
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(f"{API}?{q}", timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 400:
                raise
            time.sleep(2 ** attempt)
        except urllib.error.URLError:
            time.sleep(2 ** attempt)
    raise RuntimeError("Open-Meteo request failed after retries")


def fetch_city(lat, lon, year):
    try:
        return request(lat, lon, year, CORE + EXTRA)
    except urllib.error.HTTPError:
        return request(lat, lon, year, CORE)  # extra variables not available: fall back


def rows_from(payload, city_id):
    d = payload["daily"]
    get = lambda k, i: d[k][i] if k in d and d[k][i] is not None else None
    out = []
    for i, day in enumerate(d["time"]):
        tmax, tmin = get("temperature_2m_max", i), get("temperature_2m_min", i)
        tmean = get("temperature_2m_mean", i)
        if tmean is None and tmax is not None and tmin is not None:
            tmean = round((tmax + tmin) / 2, 2)
        out.append((city_id, day, tmax, tmin, tmean, get("relative_humidity_2m_mean", i),
                    get("precipitation_sum", i), get("wind_speed_10m_max", i),
                    get("shortwave_radiation_sum", i), get("et0_fao_evapotranspiration", i), "OPEN_METEO"))
    return out


def main():
    db_path, year = Path(sys.argv[1]), int(sys.argv[2])
    cache = Path(sys.argv[sys.argv.index("--from-json") + 1]) if "--from-json" in sys.argv else db_path.parent / f"weather_cache_{year}"
    offline = "--from-json" in sys.argv
    cache.mkdir(exist_ok=True)
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA foreign_keys = ON")
    cities = db.execute("SELECT city_id, name_en, latitude, longitude FROM cities ORDER BY city_id").fetchall()
    for city_id, name, lat, lon in cities:
        f = cache / f"{name}.json"
        if offline or f.exists():
            payload = json.loads(f.read_text())
        else:
            payload = fetch_city(lat, lon, year)
            f.write_text(json.dumps(payload))
            time.sleep(1)  # be polite to the free API
        rows = rows_from(payload, city_id)
        db.execute("DELETE FROM weather_daily WHERE city_id = ? AND date LIKE ?", (city_id, f"{year}-%"))
        db.executemany("INSERT INTO weather_daily VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
        print(f"{name}: {len(rows)} days")
    db.execute("DELETE FROM city_climate_monthly WHERE year = ?", (year,))
    db.execute("""
        INSERT INTO city_climate_monthly
        SELECT city_id, CAST(substr(date,1,4) AS INTEGER), CAST(substr(date,6,2) AS INTEGER),
               ROUND(AVG(tmean_c),2), ROUND(AVG(tmax_c),2), ROUND(AVG(tmin_c),2), ROUND(AVG(rh_mean_pct),1),
               ROUND(SUM(precip_mm),1), ROUND(AVG(et0_mm),2), COUNT(*), 'OPEN_METEO'
        FROM weather_daily WHERE substr(date,1,4) = ? GROUP BY city_id, substr(date,1,7)""", (str(year),))
    db.execute("UPDATE data_provenance SET origin='Open-Meteo (ERA5)', rows=(SELECT COUNT(*) FROM weather_daily) WHERE table_name='weather_daily'")
    db.execute("UPDATE data_provenance SET origin='Aggregated from weather_daily', rows=(SELECT COUNT(*) FROM city_climate_monthly) WHERE table_name='city_climate_monthly'")
    db.commit()
    # Sanity checks: physical ranges and completeness.
    checks = {
        "days_per_city": db.execute("SELECT MIN(n), MAX(n) FROM (SELECT COUNT(*) n FROM weather_daily WHERE date LIKE ? GROUP BY city_id)", (f"{year}-%",)).fetchone(),
        "et0_range_mm": db.execute("SELECT MIN(et0_mm), MAX(et0_mm) FROM weather_daily").fetchone(),
        "tmax_range_c": db.execute("SELECT MIN(tmax_c), MAX(tmax_c) FROM weather_daily").fetchone(),
        "null_et0": db.execute("SELECT COUNT(*) FROM weather_daily WHERE et0_mm IS NULL").fetchone()[0],
        "riyadh_et0_by_month": db.execute("SELECT month, et0_mm_day FROM city_climate_monthly m JOIN cities c USING(city_id) WHERE c.name_en='Riyadh' AND year=? ORDER BY month", (year,)).fetchall(),
    }
    print(json.dumps(checks, ensure_ascii=False, indent=1))
    db.close()


if __name__ == "__main__":
    main()
