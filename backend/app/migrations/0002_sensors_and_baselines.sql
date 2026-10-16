-- Sensors per zone and point; fixed-schedule baselines used only for comparison.
CREATE TABLE IF NOT EXISTS sensors (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL REFERENCES zone(id),
  point_id TEXT REFERENCES measurementpoint(id),
  kind TEXT NOT NULL CHECK (kind IN ('lora', 'virtual', 'manual')),
  depth_m REAL,
  installed_at TEXT,
  calibrated_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS baseline_schedules (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL REFERENCES zone(id),
  start_hour INTEGER NOT NULL,
  litres_per_m2_per_day REAL NOT NULL,
  months TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'افتراض'
);
