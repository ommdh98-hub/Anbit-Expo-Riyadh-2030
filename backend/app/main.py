from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
import json
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel, Session, select, delete
from .database import engine, is_demo_database
from .models import (
    Site,
    Zone,
    Plant,
    SoilProfile,
    ReferenceSource,
    MeasurementPoint,
    SoilMeasurement,
    Recommendation,
    IrrigationEvent,
    Inspection,
    Sensor,
    BaselineSchedule,
)
from .schemas import (
    ReadingInput,
    ActionInput,
    EventInput,
    InspectionInput,
    EstimateInput,
    SimulationInput,
)
from .engine import decide, coverage
from .seed import refresh_demo_readings, seed_demo
from .simulation import water_balance
from .auth import router as auth_router, auth_middleware
from .planning import PlanInput, plan, spatial_estimate
from .executive import executive_report, research_summary
from .presentation import public_source, public_plant
from .home import HomeInput, home_summary
from .migrate import run_migrations
from .dose import daily_dose
from . import reference


@asynccontextmanager
async def lifespan(app):
    SQLModel.metadata.create_all(engine)
    run_migrations(engine)
    app.state.auth_engine = engine
    with Session(engine) as session:
        seed_demo(session)
        # Demo database only: simulated readings keep their seeded age.
        if is_demo_database(engine):
            refresh_demo_readings(session)
    yield


app = FastAPI(title="أنبت | ANBIT API", version="0.1.0", lifespan=lifespan)
app.include_router(auth_router)
app.middleware("http")(auth_middleware)


@app.exception_handler(IntegrityError)
async def integrity_error(request: Request, exc: IntegrityError):
    return JSONResponse(
        status_code=409,
        content={
            "detail": "عملية مكررة أو مرجع غير صالح؛ حدّث البيانات وأعد المحاولة."
        },
    )


def get_zone(session, zone_id):
    zone = session.get(Zone, zone_id)
    if not zone:
        raise HTTPException(404, "المنطقة غير موجودة")
    return zone


def zone_data(session, zone):
    points = session.exec(
        select(MeasurementPoint).where(MeasurementPoint.zone_id == zone.id)
    ).all()
    readings = session.exec(
        select(SoilMeasurement)
        .where(SoilMeasurement.zone_id == zone.id)
        .order_by(SoilMeasurement.measured_at.desc())
    ).all()
    soil = session.get(SoilProfile, zone.soil_id)
    return points, readings, soil


def zone_dose(zone, soil, current_vwc):
    """Today's dose for a zone linked to the reference database (see dose.py)."""
    plant = getattr(zone, "reference_plant_id", None)
    if plant is None or current_vwc is None or soil is None or not zone.irrigated_area_m2:
        return None
    need = reference.monthly_need(plant, datetime.now(timezone(timedelta(hours=3))).month)
    if not need:
        return None
    target = reference.plant_soil_target(plant, zone.soil_class) if zone.soil_class else None
    return daily_dose(
        current_vwc=current_vwc,
        target_vwc=soil.target_vwc,
        root_depth_m=zone.root_depth_m,
        efficiency=zone.efficiency,
        area_m2=zone.irrigated_area_m2,
        wetted_fraction=zone.wetted_fraction or 1.0,
        et0_mm_day=need["et0_mm_day"],
        kc=need["kc"],
        raw_mm=target["raw_mm"] if target else None,
        flow_lph=zone.flow_rate_lph,
        vwc_min=soil.lower_vwc,
    )


def zone_view(session, zone):
    points, readings, soil = zone_data(session, zone)
    decision = decide(zone, soil, points, readings)
    return {
        **zone.model_dump(),
        "plant": public_plant(session.get(Plant, zone.plant_id)),
        "soil": soil,
        "points": points,
        "measurements": readings,
        "decision": decision,
        "dose": zone_dose(zone, soil, decision["mean_vwc"]),
    }


@app.get("/api/health")
def health():
    with Session(engine) as session:
        session.exec(select(Site)).first()
    return {"status": "ok", "database": "connected"}


@app.post("/api/zones/{zone_id}/home")
def home_outlook(zone_id: str, payload: HomeInput):
    with Session(engine) as session:
        zone = get_zone(session, zone_id)
        points, readings, soil = zone_data(session, zone)
        try:
            return home_summary(zone, soil, readings, decide(zone, soil, points, readings),
                                payload, datetime.now(timezone.utc))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc


@app.post("/api/zones/{zone_id}/plan")
def predictive_plan(zone_id: str, payload: PlanInput):
    # No schema additions, flushes or writes. Existing decision gates remain authoritative.
    with Session(engine) as session:
        z = get_zone(session, zone_id)
        points, readings, soil = zone_data(session, z)
        try:
            return plan(z, decide(z, soil, points, readings), payload,
                        datetime.now(timezone(timedelta(hours=3))))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc


@app.get("/api/zones/{zone_id}/spatial")
def spatial_outlook(zone_id: str):
    with Session(engine) as session:
        z = get_zone(session, zone_id)
        points, readings, soil = zone_data(session, z)
        return spatial_estimate(z, points, readings, decide(z, soil, points, readings))


@app.get("/api/reports/executive")
def executive(days: int = Query(7, ge=1, le=365)):
    with Session(engine) as session:
        return executive_report(session, days, zone_view)


@app.get("/api/research/forecast")
def forecast_research():
    return research_summary()


@app.get("/api/sites")
def sites():
    with Session(engine) as session:
        return session.exec(select(Site)).all()


@app.get("/api/zones")
def zones(site_id: str = "demo"):
    with Session(engine) as session:
        return [
            zone_view(session, z)
            for z in session.exec(select(Zone).where(Zone.site_id == site_id)).all()
        ]


@app.get("/api/zones/{zone_id}")
def zone_detail(zone_id: str):
    with Session(engine) as session:
        return zone_view(session, get_zone(session, zone_id))


@app.get("/api/zones/{zone_id}/measurements")
def readings(zone_id: str):
    with Session(engine) as session:
        return zone_data(session, get_zone(session, zone_id))[1]


@app.post("/api/zones/{zone_id}/measurements", status_code=201)
def add_reading(zone_id: str, payload: ReadingInput, request: Request):
    with Session(engine) as session:
        zone = get_zone(session, zone_id)
        if payload.origin != zone.origin:
            raise HTTPException(
                422, "لا يمكن خلط المحاكاة والبيانات التشغيلية في المنطقة نفسها"
            )
        if session.get(SoilMeasurement, payload.id):
            raise HTTPException(409, "تم تسجيل هذه العملية مسبقًا")
        if payload.point_id:
            point = session.get(MeasurementPoint, payload.point_id)
            if not point or point.zone_id != zone.id:
                raise HTTPException(422, "نقطة القياس لا تنتمي لهذه المنطقة")
        else:
            if not (
                zone.x <= payload.x <= zone.x + zone.width
                and zone.y <= payload.y <= zone.y + zone.height
            ):
                raise HTTPException(422, "نقطة القياس خارج حدود المنطقة")
            point = MeasurementPoint(
                id=str(uuid4()),
                zone_id=zone.id,
                x=payload.x,
                y=payload.y,
                name="نقطة فحص إضافية",
            )
            session.add(point)
            session.flush()
        data = payload.model_dump(exclude={"x", "y", "point_id"})
        data["measured_at"] = payload.measured_at.astimezone(timezone.utc).isoformat()
        data["operator"] = request.state.actor["name"]
        reading = SoilMeasurement(**data, zone_id=zone.id, point_id=point.id)
        session.add(reading)
        zone.revision += 1
        session.add(zone)
        session.commit()
        return zone_view(session, zone)


@app.get("/api/zones/{zone_id}/coverage")
@app.get("/api/zones/{zone_id}/next-measurement")
def zone_coverage(zone_id: str):
    with Session(engine) as session:
        zone = get_zone(session, zone_id)
        points, readings, _ = zone_data(session, zone)
        return coverage(zone, points, readings)


@app.post("/api/zones/{zone_id}/estimate")
def estimate(zone_id: str, payload: EstimateInput):
    with Session(engine) as session:
        zone = get_zone(session, zone_id)
        if zone.origin != "simulation":
            raise HTTPException(422, "تعديل الافتراضات متاح للمحاكاة فقط")
        if payload.irrigated_area_m2 > zone.area_m2:
            raise HTTPException(422, "مساحة الري تتجاوز مساحة المنطقة")
        zone = zone.model_copy(update=payload.model_dump())
        points, readings, soil = zone_data(session, zone)
        return decide(zone, soil, points, readings)


def recommendation_view(rec, session=None):
    result = json.loads(rec.result_json)
    view = {**rec.model_dump(exclude={"result_json"}), "result": result}
    if session is not None:
        # Today's dose alongside the stored full-refill estimate (same rule as Home).
        zone = session.get(Zone, rec.zone_id)
        soil = session.get(SoilProfile, zone.soil_id) if zone else None
        current = (result.get("estimate") or {}).get("current_vwc", result.get("mean_vwc"))
        view["dose"] = zone_dose(zone, soil, current) if zone else None
    return view


@app.post("/api/zones/{zone_id}/recommendations")
def recommend(zone_id: str):
    with Session(engine) as session:
        zone = get_zone(session, zone_id)
        points, readings, soil = zone_data(session, zone)
        result = decide(zone, soil, points, readings)
        # Reuse a still-current open recommendation; no duplicate on repeated clicks.
        for rec in session.exec(
            select(Recommendation).where(
                Recommendation.zone_id == zone.id,
                Recommendation.revision == zone.revision,
            )
        ).all():
            old = json.loads(rec.result_json)
            if (
                rec.status in ["suggested", "approved"]
                and old["code"] == result["code"]
                and old["readings_used"] == result["readings_used"]
            ):
                return recommendation_view(rec, session)
        rec = Recommendation(
            id=str(uuid4()),
            zone_id=zone.id,
            revision=zone.revision,
            result_json=json.dumps(result, ensure_ascii=False),
        )
        session.add(rec)
        session.commit()
        session.refresh(rec)
        return recommendation_view(rec, session)


@app.get("/api/recommendations")
def recommendations():
    with Session(engine) as session:
        return [
            recommendation_view(r, session)
            for r in session.exec(
                select(Recommendation).order_by(Recommendation.created_at.desc())
            ).all()
        ]


def ensure_current(session, rec):
    zone = get_zone(session, rec.zone_id)
    p, m, s = zone_data(session, zone)
    current = decide(zone, s, p, m)
    previous = json.loads(rec.result_json)
    if (
        zone.revision != rec.revision
        or current["code"] != previous["code"]
        or current["readings_used"] != previous["readings_used"]
    ):
        raise HTTPException(409, "تغيرت البيانات أو صلاحيتها؛ اطلب توصية جديدة")
    return zone, current


@app.patch("/api/recommendations/{rec_id}")
def action(rec_id: str, payload: ActionInput, request: Request):
    with Session(engine) as session:
        rec = session.get(Recommendation, rec_id)
        if not rec:
            raise HTTPException(404, "التوصية غير موجودة")
        if rec.status not in ["suggested", "approved"]:
            raise HTTPException(409, "هذه التوصية مغلقة")
        zone, current = ensure_current(session, rec)
        if payload.status == "approved" and current["code"] != "review":
            raise HTTPException(422, "لا يمكن اعتماد الري مع هذه الحالة")
        rec.status = payload.status
        rec.operator = request.state.actor["name"]
        session.add(rec)
        session.commit()
        session.refresh(rec)
        return recommendation_view(rec, session)


@app.post("/api/irrigation-events", status_code=201)
def execute(payload: EventInput, request: Request):
    with Session(engine) as session:
        rec = session.get(Recommendation, payload.recommendation_id)
        if not rec:
            raise HTTPException(404, "التوصية غير موجودة")
        if rec.status != "approved":
            raise HTTPException(409, "يجب اعتماد التوصية أولًا، ولا يمكن تنفيذها مرتين")
        zone, current = ensure_current(session, rec)
        if current["code"] != "review":
            raise HTTPException(422, "حالة المنطقة لا تسمح بتسجيل تنفيذ هذه التوصية")
        if payload.executed_at < datetime.fromisoformat(rec.created_at):
            raise HTTPException(422, "وقت التنفيذ أسبق من التوصية")
        event = IrrigationEvent(
            id=payload.id,
            recommendation_id=rec.id,
            zone_id=zone.id,
            volume_l=payload.volume * (1000 if payload.unit == "m3" else 1),
            volume_kind=payload.volume_kind,
            executed_at=payload.executed_at.astimezone(timezone.utc).isoformat(),
            operator=request.state.actor["name"],
            notes=payload.notes,
            origin=zone.origin,
        )
        rec.status = "executed"
        zone.last_irrigated_at = event.executed_at
        # Execution invalidates pre-irrigation readings until new measurements arrive.
        zone.revision += 1
        session.add(event)
        session.add(rec)
        session.add(zone)
        session.commit()
        session.refresh(event)
        return event


@app.get("/api/irrigation-events")
def events(origin: str = "simulation"):
    with Session(engine) as session:
        return session.exec(
            select(IrrigationEvent)
            .where(IrrigationEvent.origin == origin)
            .order_by(IrrigationEvent.executed_at.desc())
        ).all()


@app.get("/api/reports/water")
def water_report(
    origin: str = Query("simulation", pattern="^(simulation|manual|field|estimated)$"),
    days: int = Query(7, ge=1, le=365),
):
    start = datetime.now(timezone.utc) - timedelta(days=days)
    with Session(engine) as session:
        rows = session.exec(
            select(IrrigationEvent).where(
                IrrigationEvent.origin == origin,
                IrrigationEvent.executed_at >= start.isoformat(),
            )
        ).all()
        by_zone = []
        for z in session.exec(select(Zone).where(Zone.origin == origin)).all():
            used = [r for r in rows if r.zone_id == z.id]
            total = sum(r.volume_l for r in used)
            by_zone.append(
                {
                    "id": z.id,
                    "name": z.name,
                    "litres": total,
                    "litres_per_m2": total / z.area_m2,
                    "events": len(used),
                }
            )
        daily = {}
        for r in rows:
            day = (
                (datetime.fromisoformat(r.executed_at) + timedelta(hours=3))
                .date()
                .isoformat()
            )
            daily[day] = daily.get(day, 0) + r.volume_l
        return {
            "origin": origin,
            "days": days,
            "total_l": sum(r.volume_l for r in rows),
            "events_count": len(rows),
            "measured_l": sum(r.volume_l for r in rows if r.volume_kind == "measured"),
            "estimated_l": sum(
                r.volume_l for r in rows if r.volume_kind == "estimated"
            ),
            "by_zone": by_zone,
            "daily": [{"date": d, "litres": v} for d, v in sorted(daily.items())],
            "events": rows,
            "limitations": "سجلات المحاكاة منفصلة. لا توجد مقارنة بخط أساس تثبت توفير المياه.",
        }


@app.post("/api/zones/{zone_id}/inspections", status_code=201)
def inspect(zone_id: str, payload: InspectionInput, request: Request):
    with Session(engine) as session:
        z = get_zone(session, zone_id)
        if session.get(Inspection, payload.id):
            raise HTTPException(409, "الفحص مسجل مسبقًا")
        row = Inspection(**(payload.model_dump() | {"operator": request.state.actor["name"]}), zone_id=z.id, origin=z.origin)
        session.add(row)
        session.commit()
        session.refresh(row)
        return row


@app.get("/api/zones/{zone_id}/inspections")
def inspections(zone_id: str):
    with Session(engine) as session:
        get_zone(session, zone_id)
        return session.exec(
            select(Inspection).where(Inspection.zone_id == zone_id)
        ).all()


@app.get("/api/reference/landscape-plants")
def reference_landscape_plants():
    # Read-only reference database; empty list when the file is not installed.
    return {"available": reference.available(), "source": reference.ET_SOURCE, "plants": reference.landscape_plants()}


@app.get("/api/baseline-schedules")
def baseline_schedules():
    with Session(engine) as session:
        rows = session.exec(select(BaselineSchedule)).all()
        return [{**row.model_dump(), "months": json.loads(row.months)} for row in rows]


@app.get("/api/plants")
def plants():
    with Session(engine) as session:
        return [
            {**public_plant(p), "source": public_source(session.get(ReferenceSource, p.source_id))}
            for p in session.exec(select(Plant)).all()
        ]


@app.post("/api/demo/reset")
def reset_demo():
    with Session(engine) as session:
        ids = [
            z.id
            for z in session.exec(
                select(Zone).where(Zone.site_id == "demo", Zone.origin == "simulation")
            ).all()
        ]
        # Delete only the simulation site's dependent records, never operational sites.
        for cls in [
            IrrigationEvent,
            Inspection,
            Recommendation,
            Sensor,
            BaselineSchedule,
            SoilMeasurement,
            MeasurementPoint,
        ]:
            session.exec(delete(cls).where(cls.zone_id.in_(ids)))
        session.exec(delete(Zone).where(Zone.id.in_(ids)))
        site = session.get(Site, "demo")
        if site:
            session.delete(site)
        session.commit()
        # Shared reference entities remain; seed only simulation zone data.
        seed_demo(session)
    return {"status": "reset"}


@app.post("/api/zones/{zone_id}/simulate")
def simulate(zone_id: str, payload: SimulationInput):
    # Read-only session: no add, flush, commit, revision change, or saved output.
    with Session(engine) as session:
        zone = get_zone(session, zone_id)
        points, readings, soil = zone_data(session, zone)
        decision = decide(zone, soil, points, readings)
        if payload.irrigated_area_m2 > zone.area_m2:
            raise HTTPException(422, "مساحة السيناريو تتجاوز مساحة المنطقة")
        stored = payload.baseline_mode == "stored"
        if stored and (
            decision["code"] not in {"review", "high", "defer"}
            or not zone.root_representative
        ):
            raise HTTPException(
                422,
                "القراءات لا تمثل خط بداية كافيًا؛ أكمل القياس والتحقق أو اختر بداية افتراضية معلنة",
            )
        baseline = decision["mean_vwc"] if stored else payload.starting_vwc
        try:
            result = water_balance(
                baseline,
                payload.volume_l,
                payload.irrigated_area_m2,
                payload.root_depth_m,
                payload.efficiency,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        used = (
            [r for r in readings if r.id in decision["readings_used"]] if stored else []
        )
        return {
            "zone_id": zone.id,
            "revision": zone.revision,
            "kind": "hypothetical_only",
            "baseline_vwc": baseline,
            "baseline_origin": zone.origin if stored else "user_hypothesis",
            "baseline_reading_ids": [r.id for r in used],
            "baseline_sources": sorted({r.source for r in used}),
            "baseline_timestamps": [r.measured_at for r in used],
            "inputs": payload.model_dump(),
            **result,
            "thresholds": soil.model_dump() if soil else None,
            "formula": "ΔVWC = (L / m² × efficiency) / (root_depth_m × 1000)",
            "limitations": "موازنة نظرية فورية بافتراض توزيع منتظم واحتفاظ كامل بالماء الفعال داخل عمق الجذور. لا تحسب التبخر أو الصرف أو الجريان أو التسرب أو إعادة التوزيع أو امتصاص النبات أو التباين المكاني. ليست تنبؤًا ولا إذن ري؛ مسامية التربة غير متوفرة، وحدود الإدارة ليست حدود تشبع.",
        }
