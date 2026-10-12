from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, str_strip_whitespace=True)


class ReadingInput(Input):
    id: str = Field(min_length=8,max_length=80)
    point_id: str | None = None
    x: float | None = None
    y: float | None = None
    value: float = Field(ge=0)
    unit: Literal['vwc_percent','vwc_fraction','raw']
    measured_at: datetime
    source: str = Field(min_length=2,max_length=200)
    operator: str = Field(min_length=2,max_length=100)
    quality: Literal['verified','unverified','suspect']
    origin: Literal['simulation','manual','field','estimated']
    evidence: str | None = Field(default=None,max_length=500)

    @model_validator(mode='after')
    def validate_reading(self):
        limit={'vwc_percent':100,'vwc_fraction':1,'raw':1_000_000}[self.unit]
        if self.value > limit:
            raise ValueError('قيمة القراءة خارج حدود الوحدة')
        if self.measured_at.tzinfo is None or self.measured_at > datetime.now(timezone.utc):
            raise ValueError('وقت القراءة يجب أن يكون سابقًا أو حاليًا مع منطقة زمنية')
        if not self.point_id and (self.x is None or self.y is None):
            raise ValueError('حدد نقطة قياس أو إحداثيات محلية')
        if self.origin == 'field' and not self.evidence:
            raise ValueError('القياس الميداني يحتاج مرجع تحقق')
        if self.quality == 'verified' and self.origin != 'simulation' and not self.evidence:
            raise ValueError('القراءة المتحققة تحتاج دليل مصدر')
        return self


class ActionInput(Input):
    status: Literal['approved','deferred']
    operator: str = Field(min_length=2,max_length=100)


class EventInput(Input):
    id: str = Field(min_length=8,max_length=80)
    recommendation_id: str
    volume: float = Field(gt=0,le=1_000_000)
    unit: Literal['L','m3']
    volume_kind: Literal['measured','estimated']
    executed_at: datetime
    operator: str = Field(min_length=2,max_length=100)
    notes: str = Field(default='',max_length=1000)

    @model_validator(mode='after')
    def valid_time(self):
        if self.executed_at.tzinfo is None or self.executed_at > datetime.now(timezone.utc):
            raise ValueError('وقت التنفيذ غير صالح')
        return self


class InspectionInput(Input):
    id: str = Field(min_length=8,max_length=80)
    notes: str = Field(min_length=3,max_length=1000)
    operator: str = Field(min_length=2,max_length=100)


class EstimateInput(Input):
    irrigated_area_m2: float = Field(gt=0,le=1_000_000)
    root_depth_m: float = Field(gt=0,le=3)
    efficiency: float = Field(gt=0,le=1)
    root_representative: bool
    homogeneous: bool
