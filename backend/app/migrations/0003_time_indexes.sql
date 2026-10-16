-- Time-ordered lookups per zone.
CREATE INDEX IF NOT EXISTS ix_soilmeasurement_zone_measured ON soilmeasurement (zone_id, measured_at);
CREATE INDEX IF NOT EXISTS ix_recommendation_zone_created ON recommendation (zone_id, created_at);
CREATE INDEX IF NOT EXISTS ix_irrigationevent_zone_executed ON irrigationevent (zone_id, executed_at);
