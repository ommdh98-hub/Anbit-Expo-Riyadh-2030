# Digital Twin model (simulation only)

`python3 research/simulation/train_sim_model.py` reads `smart_irrigation_training_data.csv`, writes `metrics.json` here and `frontend/lib/twin/model.json`. Standard library only, fixed seed 42, 80/20 split. Re-running gives byte-identical output.

## What the data is

- 15,420 synthetic rows. No time, date or location columns. No duplicate rows.
- `irrigationNeeded` is exactly `soilMoisture <= 36` for all 15,420 rows (no values between 37 and 41). Rain appears only with wet soil, so it adds nothing.
- `predictedMinutes` (when needed) is spread 5–30 with no correlation to any feature (|r| < 0.01).
- `soilMoisture` is a sensor index (10–90), not VWC. The twin assumes 10 = wilting point and 90 = field capacity of each section's soil, linear in between.

## Results (test split, 3,084 rows)

| | Accuracy | Notes |
|---|---|---|
| Decision tree (`irrigationNeeded`) | 100% | One split: `soilMoisture <= 39` |
| One-line rule `soilMoisture <= 36` | 100% | Same result |
| Tree for `predictedMinutes` | R² ≈ 0.00, MAE 6.5 min | Equal to predicting the mean |

These scores show only that a tree can recover the rule used to generate the data. They say nothing about real-world irrigation. The twin uses the classifier for the need decision only when the inputs are inside the training ranges (temperature 20–38 °C, humidity 35–95%), and falls back to the water-balance rule otherwise. Durations always come from the water balance, because the minutes model has no signal.

`relayState`, `drySoilRisk` and `waterLevel` are excluded as leakage or irrelevant.
