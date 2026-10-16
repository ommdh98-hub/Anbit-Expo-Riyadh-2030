-- Wetted fraction of the zone (FAO-56 fw): spray 1.0, drip 0.4 (demo assumption).
ALTER TABLE zone ADD COLUMN wetted_fraction REAL;
