-- Irrigation settings per zone, linked to the read-only reference database.
ALTER TABLE zone ADD COLUMN soil_class TEXT;
ALTER TABLE zone ADD COLUMN reference_plant_id INTEGER;
ALTER TABLE zone ADD COLUMN irrigation_method TEXT;
ALTER TABLE zone ADD COLUMN flow_rate_lph REAL;
ALTER TABLE zone ADD COLUMN allowed_start_hour INTEGER;
ALTER TABLE zone ADD COLUMN allowed_end_hour INTEGER;
