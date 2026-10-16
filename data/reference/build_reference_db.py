"""Build ANBIT_reference.db: a cleaned, documented reference database.

Input : ENBT.db (read-only), the team's plant/city database.
Output: ANBIT_reference.db  (new file; the input is never modified)

What it does
- Keeps every source row (no deletions) and fixes units where the fix is certain.
- Replaces the undocumented water_needs scale with FAO-56 style parameters
  (monthly Kc, effective root zone, depletion fraction p).
- Adds soil hydraulic properties and plant x soil moisture targets.
- Adds empty, typed weather tables filled later by fetch_weather.py.
- Moves the generated irrigation history to a clearly labelled synthetic table.

Usage: python3 build_reference_db.py ENBT.db ANBIT_reference.db [--no-synthetic]
  --no-synthetic  leave irrigation_history_synthetic empty (small file for the app)
"""
import re
import sqlite3
import sys
from pathlib import Path

import pandas as pd

ARGS = [x for x in sys.argv[1:] if not x.startswith("--")]
NO_SYNTH = "--no-synthetic" in sys.argv
SRC = Path(ARGS[0] if ARGS else "ENBT.db")
OUT = Path(ARGS[1] if len(ARGS) > 1 else "ANBIT_reference.db")
if OUT.exists():
    OUT.unlink()

src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
plant = pd.read_sql("SELECT * FROM Plant", src)
cities = pd.read_sql("SELECT * FROM Cities", src)
suit = pd.read_sql("SELECT * FROM PlantCitySuitability", src)
hist = pd.read_sql("SELECT * FROM IrrigationHistory", src)
src.close()

SOURCES = {
    "FAO56_T12": "Allen et al. (1998) FAO Irrigation and Drainage Paper 56, Table 12 — https://www.fao.org/4/X0490E/x0490e0b.htm",
    "FAO56_T22": "Allen et al. (1998) FAO-56, Table 22 (root depth Zr, depletion fraction p) — https://www.fao.org/4/X0490E/x0490e0e.htm",
    "AZ1195": "Brown & Kopec, Converting Reference Evapotranspiration into Turf Water Use, Univ. of Arizona AZ1195 — https://extension.arizona.edu/sites/default/files/2024-08/az1195.pdf",
    "UCANR_2018": "Water Requirements of Landscape Plants (UC researchers), HortTechnology 2018: warm-season turf Kc 0.6, cool-season 0.8 — https://class.ucanr.edu/sites/default/files/2020-04/323525.pdf",
    "WUCOLS": "WUCOLS IV plant water-use classes (very low <0.1, low 0.1–0.3, moderate 0.4–0.6, high 0.7–0.9), UC ANR",
    "HANSON2000": "Hanson, Orloff & Peters (2000) California Agriculture 54(3):38–42, via Texas A&M E-618 Table 1 — https://texaslocalproduce.tamu.edu/files/2023/08/E-618-Irrigation-Monitoring-with-Soil-Water-Sensors.pdf",
    "ENBT": "Team plant/city database ENBT.db (origin of values not independently verified)",
    "OPEN_METEO": "Open-Meteo historical weather API (ERA5 reanalysis) — https://open-meteo.com/en/docs/historical-weather-api",
}

# --------------------------------------------------------------------- plants
AR = {
    "Date Palm": "نخيل التمر", "Mango": "المانجو", "Pomegranate": "الرمان", "Guava": "الجوافة",
    "Grapes": "العنب", "Olive": "الزيتون", "Orange & Mandarin": "البرتقال واليوسفي",
    "Lime & Lemon": "الليمون اللايم والليمون", "Cantaloupe": "الشمام", "Papaya": "البابايا",
    "Prickly Pear": "التين الشوكي", "Tomato": "الطماطم", "Cucumber": "الخيار", "Bell Pepper": "الفلفل الحلو",
    "Eggplant": "الباذنجان", "Onion": "البصل", "Potato": "البطاطس",
    "Bermuda Grass": "نجيل برمودا", "Paspalum Vaginatum": "باسبالوم", "Zoysia Grass": "زويسيا",
    "Buffalo Grass": "عشب الجاموس", "Bahia Grass": "عشب باهيا", "Fountain Grass": "عشب النافورة",
    "Muhly Grass": "عشب المولي", "Switchgrass": "عشب السويتش", "Maiden Grass": "عشب ميسكانثوس",
    "Blue Grama": "غراما الزرقاء", "Liriope": "ليريوب", "Monkey Grass": "عشب القرد (أوفيوبوجون)",
    "Gazania": "جازانيا", "Ice Plant": "نبات الثلج", "Trailing Rosemary": "إكليل الجبل الزاحف",
    "Carpet Grass": "عشب السجادة", "Centipede Grass": "عشب الحريش", "Tall Fescue": "الفيسكيو الطويل",
    "Ryegrass": "الراي جراس", "Kentucky Bluegrass": "البلوجراس الكنتاكي",
}

# category, use_case, kc_summer, kc_winter, root_zone_m, p, method, wucols, kc_source, note
LP = {
    # palms and trees used in landscapes
    "Date Palm":          ("palm", "both", 0.95, 0.90, 1.50, 0.50, "drip", None, "FAO56_T12;FAO56_T22", "Agricultural Kc; landscape palms often lower."),
    "Olive":              ("tree", "both", 0.70, 0.65, 1.20, 0.65, "drip", None, "FAO56_T12;FAO56_T22", "40–60% canopy cover."),
    # warm-season turf
    "Bermuda Grass":      ("turf_warm", "landscape", 0.80, 0.50, 0.25, 0.50, "spray", None, "AZ1195;FAO56_T22", "Summer 0.6–0.8 (AZ1195); dormant ~0.5 when irrigated."),
    "Paspalum Vaginatum": ("turf_warm", "landscape", 0.80, 0.55, 0.25, 0.50, "spray", None, "AZ1195;FAO56_T22", "Warm-season turf values applied."),
    "Zoysia Grass":       ("turf_warm", "landscape", 0.75, 0.50, 0.25, 0.50, "spray", None, "AZ1195;FAO56_T22", "Warm-season turf values applied."),
    "Buffalo Grass":      ("turf_warm", "landscape", 0.60, 0.40, 0.30, 0.50, "spray", None, "UCANR_2018;FAO56_T22", "Low-input warm-season turf."),
    "Bahia Grass":        ("turf_warm", "landscape", 0.70, 0.50, 0.25, 0.50, "spray", None, "AZ1195;FAO56_T22", "Warm-season turf values applied."),
    "Carpet Grass":       ("turf_warm", "landscape", 0.75, 0.50, 0.25, 0.50, "spray", None, "AZ1195;FAO56_T22", "Warm-season turf values applied."),
    "Centipede Grass":    ("turf_warm", "landscape", 0.70, 0.50, 0.25, 0.50, "spray", None, "AZ1195;FAO56_T22", "Warm-season turf values applied."),
    # cool-season turf (stressed in Riyadh summer)
    "Tall Fescue":        ("turf_cool", "landscape", 0.85, 0.75, 0.25, 0.40, "spray", None, "FAO56_T12;UCANR_2018;FAO56_T22", "FAO 0.95 reduced 0.10 for managed turf (FAO-56 footnote)."),
    "Ryegrass":           ("turf_cool", "landscape", 0.85, 0.75, 0.25, 0.40, "spray", None, "FAO56_T12;AZ1195;FAO56_T22", "Overseeding grass; AZ1195 good level 0.75."),
    "Kentucky Bluegrass": ("turf_cool", "landscape", 0.85, 0.75, 0.25, 0.40, "spray", None, "FAO56_T12;UCANR_2018;FAO56_T22", "Not well suited to Riyadh summer."),
    # ornamental grasses (WUCOLS low–moderate)
    "Fountain Grass":     ("ornamental_grass", "landscape", 0.40, 0.25, 0.40, 0.60, "drip", "low-moderate", "WUCOLS", "Plant factor, not an agronomic Kc."),
    "Muhly Grass":        ("ornamental_grass", "landscape", 0.40, 0.25, 0.40, 0.60, "drip", "low-moderate", "WUCOLS", "Plant factor, not an agronomic Kc."),
    "Switchgrass":        ("ornamental_grass", "landscape", 0.45, 0.30, 0.50, 0.60, "drip", "moderate", "WUCOLS", "Plant factor, not an agronomic Kc."),
    "Maiden Grass":       ("ornamental_grass", "landscape", 0.45, 0.30, 0.50, 0.60, "drip", "moderate", "WUCOLS", "Plant factor, not an agronomic Kc."),
    "Blue Grama":         ("ornamental_grass", "landscape", 0.30, 0.20, 0.40, 0.60, "drip", "low", "WUCOLS", "Plant factor, not an agronomic Kc."),
    # groundcovers
    "Liriope":            ("groundcover", "landscape", 0.50, 0.35, 0.30, 0.50, "drip", "moderate", "WUCOLS", "Partial shade."),
    "Monkey Grass":       ("groundcover", "landscape", 0.50, 0.35, 0.30, 0.50, "drip", "moderate", "WUCOLS", "Partial shade."),
    "Gazania":            ("groundcover", "landscape", 0.30, 0.20, 0.30, 0.60, "drip", "low", "WUCOLS", "Plant factor."),
    "Ice Plant":          ("groundcover", "landscape", 0.20, 0.15, 0.25, 0.60, "drip", "low", "WUCOLS", "Succulent groundcover."),
    "Trailing Rosemary":  ("groundcover", "landscape", 0.30, 0.20, 0.30, 0.60, "drip", "low", "WUCOLS", "Plant factor."),
}
EXTRA = [  # landscape plants missing from ENBT, added with explicit sources
    {"name": "Bougainvillea", "name_ar": "الجهنمية", "row": ("shrub", "landscape", 0.30, 0.20, 0.50, 0.60, "drip", "low", "WUCOLS", "Added by ANBIT; not in ENBT.")},
    {"name": "Landscape shrubs (moderate)", "name_ar": "شجيرات تنسيق (احتياج متوسط)", "row": ("shrub", "landscape", 0.50, 0.35, 0.50, 0.50, "drip", "moderate", "WUCOLS", "Generic class for mixed shrub beds.")},
]


def soil_class(text):
    t = str(text).lower()
    if "clay loam" in t: return "clay_loam"
    if "clay" in t: return "clay"
    if "sandy loam" in t: return "sandy_loam"
    if "silt" in t: return "silt_loam"
    if "loam" in t: return "loam"
    if "sand" in t: return "sand"
    if "rock" in t or "gravel" in t: return "sand"
    return "loam"


def sun_min(text):
    nums = [float(n) for n in re.findall(r"(\d+)\s*%", str(text))]
    if nums: return min(nums)
    t = str(text).lower()
    if "full sun" in t: return 100.0
    if "partial sun" in t: return 60.0
    if "partial shade" in t: return 40.0
    return None


p = plant.copy()
p["name_ar"] = p["name"].map(AR)
p["root_depth_m"] = p["root_depth"].where(p["root_depth"] <= 10, p["root_depth"] / 100.0).round(3)
p["root_depth_unit_fixed"] = (p["root_depth"] > 10).astype(int)
p["soil_class"] = p["soil_type"].map(soil_class)
p["sun_min_pct"] = p["sun_exposure"].map(sun_min)
p["plant_group"] = p["name"].map(lambda n: LP[n][0] if n in LP else ("vegetable" if n in
    {"Tomato", "Cucumber", "Bell Pepper", "Eggplant", "Onion", "Potato", "Cantaloupe"} else "fruit_tree"))
p["use_case"] = p["name"].map(lambda n: LP[n][1] if n in LP else "individuals")
plants_out = p.rename(columns={"id": "plant_id", "name": "name_en", "soil_type": "soil_text",
                               "crop_coefficient": "kc_legacy", "water_needs": "water_needs_legacy",
                               "root_depth": "root_depth_legacy"})[
    ["plant_id", "name_en", "name_ar", "plant_group", "use_case", "temp_low", "temp_high", "humidity_min",
     "humidity_max", "drought_tolerance", "soil_class", "soil_text", "preferred_season", "sun_exposure",
     "sun_min_pct", "root_depth_m", "root_depth_legacy", "root_depth_unit_fixed", "growth_days", "kc_legacy",
     "water_needs_legacy", "description"]]
next_id = int(plants_out.plant_id.max()) + 1
for i, e in enumerate(EXTRA):
    plants_out = pd.concat([plants_out, pd.DataFrame([{
        "plant_id": next_id + i, "name_en": e["name"], "name_ar": e["name_ar"], "plant_group": e["row"][0],
        "use_case": e["row"][1], "soil_class": "sandy_loam", "root_depth_m": e["row"][4],
        "description": "Added by ANBIT for landscape coverage.", "root_depth_unit_fixed": 0}])], ignore_index=True)
    LP[e["name"]] = e["row"]

lp_rows = []
for _, r in plants_out.iterrows():
    if r.name_en in LP:
        c, use, ks, kw, zr, pp, meth, wuc, srcs, note = LP[r.name_en]
        lp_rows.append({"plant_id": r.plant_id, "category": c, "kc_summer": ks, "kc_winter": kw, "root_zone_m": zr,
                        "depletion_p": pp, "irrigation_method": meth, "wucols_class": wuc,
                        "sources": srcs, "note": note})
landscape = pd.DataFrame(lp_rows)

# Monthly Kc for Riyadh seasons: summer Jun–Sep, winter Dec–Feb, shoulders interpolated.
SHAPE = {1: 0.0, 2: 0.0, 3: 0.33, 4: 0.67, 5: 0.9, 6: 1.0, 7: 1.0, 8: 1.0, 9: 1.0, 10: 0.67, 11: 0.33, 12: 0.0}
kc_monthly = pd.DataFrame([{"plant_id": r.plant_id, "month": m,
                            "kc": round(r.kc_winter + (r.kc_summer - r.kc_winter) * w, 3)}
                           for _, r in landscape.iterrows() for m, w in SHAPE.items()])

# --------------------------------------------------------------------- soils
soils = pd.DataFrame([
    ("sand", 0.10, 0.04), ("loamy_sand", 0.16, 0.07), ("sandy_loam", 0.21, 0.09), ("loam", 0.27, 0.12),
    ("silt_loam", 0.30, 0.15), ("sandy_clay_loam", 0.36, 0.20), ("sandy_clay", 0.32, 0.18),
    ("clay_loam", 0.29, 0.18), ("silty_clay_loam", 0.28, 0.15), ("silty_clay", 0.40, 0.20), ("clay", 0.40, 0.22),
], columns=["soil_class", "fc_vwc", "wp_vwc"])
soils["aw_vwc"] = (soils.fc_vwc - soils.wp_vwc).round(3)
soils["source"] = "HANSON2000"

# Targets: trigger when p of available water is used (FAO-56 RAW = p*TAW);
# refill to 90% of available water to leave room for rain and avoid drainage.
TARGET_FRACTION = 0.90
tg = []
for _, r in landscape.iterrows():
    for _, s in soils.iterrows():
        aw = s.fc_vwc - s.wp_vwc
        tg.append({"plant_id": r.plant_id, "soil_class": s.soil_class, "root_zone_m": r.root_zone_m,
                   "vwc_min": round(s.fc_vwc - r.depletion_p * aw, 3),
                   "vwc_target": round(s.wp_vwc + TARGET_FRACTION * aw, 3),
                   "vwc_max": s.fc_vwc,
                   "taw_mm": round(aw * r.root_zone_m * 1000, 1),
                   "raw_mm": round(r.depletion_p * aw * r.root_zone_m * 1000, 1),
                   "method": "min = FC − p·AW (FAO-56 RAW); target = WP + 0.9·AW; max = FC"})
targets = pd.DataFrame(tg)

# --------------------------------------------------------------------- cities
COORDS = {  # same points as the team's SMAP export script
    "Riyadh": (24.7136, 46.6753, "الرياض"), "Mecca": (21.3891, 39.8579, "مكة المكرمة"),
    "Medina": (24.5247, 39.5692, "المدينة المنورة"), "Jazan": (16.8892, 42.5511, "جازان"),
    "Al_Qassim": (26.3592, 43.9818, "القصيم (بريدة)"), "Al_Baha": (20.0129, 41.4677, "الباحة"),
    "Abha": (18.2465, 42.5117, "أبها"), "Taif": (21.2703, 40.4158, "الطائف"),
    "Al_Jouf": (29.9697, 40.2064, "الجوف (سكاكا)"), "Hail": (27.5219, 41.6907, "حائل"),
    "Tabuk": (28.3838, 36.5550, "تبوك"), "Najran": (17.5650, 44.2289, "نجران"),
    "Al_Hasa": (25.3647, 49.5877, "الأحساء (الهفوف)"), "Al_Kharj": (24.1483, 47.3050, "الخرج"),
}
c = cities.rename(columns={"id": "city_id", "name": "name_en", "avg_temp": "legacy_avg_temp_c",
                           "avg_humidity": "legacy_avg_rh_pct", "drought_index": "legacy_drought_index",
                           "rainfall_mm": "legacy_rain_mm_year", "wind_speed": "legacy_wind_speed_unknown_unit",
                           "evapotranspiration": "legacy_et0_mm_day"})
c["name_ar"] = c.name_en.map(lambda n: COORDS[n][2])
c["latitude"] = c.name_en.map(lambda n: COORDS[n][0])
c["longitude"] = c.name_en.map(lambda n: COORDS[n][1])
cities_out = c[["city_id", "name_en", "name_ar", "latitude", "longitude", "legacy_avg_temp_c", "legacy_avg_rh_pct",
                "legacy_drought_index", "legacy_rain_mm_year", "legacy_wind_speed_unknown_unit", "legacy_et0_mm_day"]]

# --------------------------------------------------------------------- suitability
suit_out = suit[["plant_id", "city_id", "suitability_score"]].copy()

# --------------------------------------------------------------------- synthetic history
h = hist.sort_values(["plant_id", "city_id", "id"]).rename(columns={"id": "record_id"})
h["record_index"] = h.groupby(["plant_id", "city_id"]).cumcount() + 1
h["rain_flag"] = (h.rainfall > 0.465).astype(int)
h = h.drop(columns=["drought_index", "evapotranspiration"])
h = h[["record_id", "plant_id", "city_id", "record_index", "temperature", "humidity", "rainfall", "rain_flag",
       "irrigation_liters", "health_score"]]

# --------------------------------------------------------------------- write
db = sqlite3.connect(OUT)
db.execute("PRAGMA foreign_keys = ON")
db.executescript("""
CREATE TABLE sources (key TEXT PRIMARY KEY, citation TEXT NOT NULL);
CREATE TABLE data_provenance (table_name TEXT PRIMARY KEY, origin TEXT NOT NULL, rows INTEGER, notes TEXT);
CREATE TABLE plants (
  plant_id INTEGER PRIMARY KEY, name_en TEXT NOT NULL UNIQUE, name_ar TEXT, plant_group TEXT NOT NULL,
  use_case TEXT NOT NULL CHECK (use_case IN ('individuals','landscape','both')),
  temp_low REAL, temp_high REAL, humidity_min REAL, humidity_max REAL, drought_tolerance INTEGER,
  soil_class TEXT, soil_text TEXT, preferred_season TEXT, sun_exposure TEXT, sun_min_pct REAL,
  root_depth_m REAL, root_depth_legacy REAL, root_depth_unit_fixed INTEGER, growth_days INTEGER,
  kc_legacy REAL, water_needs_legacy REAL, description TEXT);
CREATE TABLE soil_hydraulics (
  soil_class TEXT PRIMARY KEY, fc_vwc REAL NOT NULL, wp_vwc REAL NOT NULL, aw_vwc REAL NOT NULL,
  source TEXT NOT NULL REFERENCES sources(key), CHECK (fc_vwc > wp_vwc));
CREATE TABLE landscape_params (
  plant_id INTEGER PRIMARY KEY REFERENCES plants(plant_id), category TEXT NOT NULL,
  kc_summer REAL NOT NULL, kc_winter REAL NOT NULL, root_zone_m REAL NOT NULL, depletion_p REAL NOT NULL,
  irrigation_method TEXT NOT NULL CHECK (irrigation_method IN ('spray','drip')), wucols_class TEXT,
  sources TEXT NOT NULL, note TEXT);
CREATE TABLE kc_monthly (
  plant_id INTEGER NOT NULL REFERENCES plants(plant_id), month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  kc REAL NOT NULL, PRIMARY KEY (plant_id, month));
CREATE TABLE plant_soil_targets (
  plant_id INTEGER NOT NULL REFERENCES plants(plant_id), soil_class TEXT NOT NULL REFERENCES soil_hydraulics(soil_class),
  root_zone_m REAL NOT NULL, vwc_min REAL NOT NULL, vwc_target REAL NOT NULL, vwc_max REAL NOT NULL,
  taw_mm REAL NOT NULL, raw_mm REAL NOT NULL, method TEXT NOT NULL,
  PRIMARY KEY (plant_id, soil_class), CHECK (vwc_min < vwc_target AND vwc_target <= vwc_max));
CREATE TABLE cities (
  city_id INTEGER PRIMARY KEY, name_en TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL,
  latitude REAL NOT NULL, longitude REAL NOT NULL, legacy_avg_temp_c REAL, legacy_avg_rh_pct REAL,
  legacy_drought_index REAL, legacy_rain_mm_year REAL, legacy_wind_speed_unknown_unit REAL, legacy_et0_mm_day REAL);
CREATE TABLE plant_city_suitability (
  plant_id INTEGER NOT NULL REFERENCES plants(plant_id), city_id INTEGER NOT NULL REFERENCES cities(city_id),
  suitability_score REAL NOT NULL, PRIMARY KEY (plant_id, city_id));
CREATE TABLE weather_daily (
  city_id INTEGER NOT NULL REFERENCES cities(city_id), date TEXT NOT NULL,
  tmax_c REAL, tmin_c REAL, tmean_c REAL, rh_mean_pct REAL, precip_mm REAL, wind_max_ms REAL,
  shortwave_mj_m2 REAL, et0_mm REAL, source TEXT NOT NULL REFERENCES sources(key), PRIMARY KEY (city_id, date));
CREATE TABLE city_climate_monthly (
  city_id INTEGER NOT NULL REFERENCES cities(city_id), year INTEGER NOT NULL, month INTEGER NOT NULL,
  tmean_c REAL, tmax_c REAL, tmin_c REAL, rh_mean_pct REAL, precip_mm REAL, et0_mm_day REAL, days INTEGER,
  source TEXT NOT NULL REFERENCES sources(key), PRIMARY KEY (city_id, year, month));
CREATE TABLE irrigation_history_synthetic (
  record_id INTEGER PRIMARY KEY, plant_id INTEGER NOT NULL REFERENCES plants(plant_id),
  city_id INTEGER NOT NULL REFERENCES cities(city_id), record_index INTEGER NOT NULL,
  temperature REAL, humidity REAL, rainfall REAL, rain_flag INTEGER, irrigation_liters REAL, health_score REAL);
CREATE INDEX ix_hist_plant_city ON irrigation_history_synthetic(plant_id, city_id);
CREATE INDEX ix_weather_date ON weather_daily(date);
CREATE VIEW v_monthly_water_need AS
  SELECT m.city_id, m.year, m.month, k.plant_id, k.kc, m.et0_mm_day,
         ROUND(m.et0_mm_day * k.kc, 2) AS etc_mm_day,
         ROUND(MAX(m.et0_mm_day * k.kc - m.precip_mm * 0.8 / m.days, 0), 2) AS net_need_mm_day
  FROM city_climate_monthly m JOIN kc_monthly k ON k.month = m.month;
""")
pd.DataFrame(list(SOURCES.items()), columns=["key", "citation"]).to_sql("sources", db, if_exists="append", index=False)
plants_out.to_sql("plants", db, if_exists="append", index=False)
soils.to_sql("soil_hydraulics", db, if_exists="append", index=False)
landscape.to_sql("landscape_params", db, if_exists="append", index=False)
kc_monthly.to_sql("kc_monthly", db, if_exists="append", index=False)
targets.to_sql("plant_soil_targets", db, if_exists="append", index=False)
cities_out.to_sql("cities", db, if_exists="append", index=False)
suit_out.to_sql("plant_city_suitability", db, if_exists="append", index=False)
if not NO_SYNTH:
    h.to_sql("irrigation_history_synthetic", db, if_exists="append", index=False)
prov = [
    ("plants", "ENBT + ANBIT fixes", len(plants_out), "root_depth cm→m for turf; soil/sun parsed; Arabic names; 2 landscape plants added; water_needs kept as legacy only."),
    ("landscape_params", "Literature", len(landscape), "Kc, root zone, depletion p per plant; see sources column."),
    ("kc_monthly", "Derived", len(kc_monthly), "Summer Jun–Sep, winter Dec–Feb, shoulders interpolated."),
    ("soil_hydraulics", "Literature (HANSON2000)", len(soils), "Typical volumetric FC/WP by texture."),
    ("plant_soil_targets", "Derived", len(targets), "FAO-56 RAW logic; demo-grade until field calibration."),
    ("cities", "ENBT + coordinates", len(cities_out), "Legacy climate columns kept with unit notes; coordinates from the SMAP export script."),
    ("plant_city_suitability", "ENBT", len(suit_out), "expected_water dropped (copy of water_needs); recommendation dropped (derived from score)."),
    ("weather_daily", "Empty — filled by fetch_weather.py", 0, "Open-Meteo/ERA5."),
    ("city_climate_monthly", "Empty — filled by fetch_weather.py", 0, "Aggregated from weather_daily."),
    ("irrigation_history_synthetic", "ENBT (generated)", 0 if NO_SYNTH else len(h), "No dates, per-plant independent weather, no seasonality; irrigation ≈1.4–1.65× ET0·Kc. Do not use as weather or as an irrigation target."),
]
pd.DataFrame(prov, columns=["table_name", "origin", "rows", "notes"]).to_sql("data_provenance", db, if_exists="append", index=False)
db.commit()
bad = db.execute("PRAGMA foreign_key_check").fetchall()
ok = db.execute("PRAGMA integrity_check").fetchone()[0]
db.execute("VACUUM")
db.close()
print("integrity:", ok, "| foreign key problems:", len(bad))
for t, o, n, _ in prov:
    print(f"  {t}: {n}")
print("size MB:", round(OUT.stat().st_size / 1e6, 2))
