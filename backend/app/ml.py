"""Future ML boundary: no trained or synthetic-accuracy model is shipped."""
from typing import Protocol
from pydantic import BaseModel


class MoistureFeatures(BaseModel):
    zone_id: str
    measured_at: str
    previous_vwc: list[float]
    soil_profile_id: str
    temperature_c: float | None = None
    rainfall_mm: float | None = None


class MoisturePrediction(BaseModel):
    predicted_vwc: float
    model_version: str
    training_data_reference: str
    lower_vwc: float | None = None
    upper_vwc: float | None = None
    origin: str = 'estimated'


class MoisturePredictor(Protocol):
    def predict(self, features: MoistureFeatures) -> MoisturePrediction: ...

# A future prediction must remain separate from field observations. Integration
# needs temporal/site holdouts, MAE/RMSE, a persistence baseline, and calibration.
