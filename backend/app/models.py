"""Persistence entities. Coordinates use local metres, never geographic coordinates."""

from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class Site(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    origin: str = "simulation"


class ReferenceSource(SQLModel, table=True):
    id: str = Field(primary_key=True)
    title: str
    description: str
    url: Optional[str] = None


class Plant(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    scientific_name: Optional[str] = None
    notes: str
    source_id: str = Field(foreign_key="referencesource.id")


class SoilProfile(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    lower_vwc: float
    target_vwc: float
    upper_vwc: float
    calibration: str = "demo_assumption"


class Zone(SQLModel, table=True):
    id: str = Field(primary_key=True)
    site_id: str = Field(foreign_key="site.id")
    name: str
    plant_id: str = Field(foreign_key="plant.id")
    soil_id: str = Field(foreign_key="soilprofile.id")
    x: float
    y: float
    width: float
    height: float
    area_m2: float
    irrigated_area_m2: Optional[float] = None
    root_depth_m: Optional[float] = None
    efficiency: Optional[float] = None
    root_representative: bool = False
    homogeneous: bool = False
    method: str = "تنقيط"
    origin: str = "simulation"
    freshness_hours: float = 24
    coverage_radius_m: float = 8
    min_coverage: float = 0.8
    conflict_vwc: float = 0.12
    revision: int = 1
    last_irrigated_at: Optional[str] = None


class MeasurementPoint(SQLModel, table=True):
    id: str = Field(primary_key=True)
    zone_id: str = Field(foreign_key="zone.id", index=True)
    x: float
    y: float
    name: str


class SoilMeasurement(SQLModel, table=True):
    id: str = Field(primary_key=True)
    zone_id: str = Field(foreign_key="zone.id", index=True)
    point_id: str = Field(foreign_key="measurementpoint.id")
    value: float
    unit: str
    measured_at: str
    source: str
    operator: str
    quality: str
    origin: str
    evidence: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class Recommendation(SQLModel, table=True):
    id: str = Field(primary_key=True)
    zone_id: str = Field(foreign_key="zone.id", index=True)
    revision: int
    status: str = "suggested"
    result_json: str
    operator: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class IrrigationEvent(SQLModel, table=True):
    id: str = Field(primary_key=True)
    recommendation_id: str = Field(foreign_key="recommendation.id", unique=True)
    zone_id: str = Field(foreign_key="zone.id")
    volume_l: float
    volume_kind: str
    executed_at: str
    operator: str
    notes: str = ""
    origin: str


class Inspection(SQLModel, table=True):
    id: str = Field(primary_key=True)
    zone_id: str = Field(foreign_key="zone.id")
    notes: str
    operator: str
    created_at: str = Field(default_factory=now_iso)
    origin: str
