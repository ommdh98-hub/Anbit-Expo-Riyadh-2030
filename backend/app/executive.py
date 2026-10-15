"""Executive read-only snapshot. Origins and measured/estimated volumes stay separate."""

from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
from sqlmodel import select
from .models import Zone, IrrigationEvent, Recommendation, ReferenceSource, Plant
from .planning import savings
from .presentation import public_source


def research_summary():
    path = (
        Path(__file__).resolve().parents[2]
        / "research"
        / "turfgrass"
        / "forecast_results.json"
    )
    if not path.exists():
        return {
            "operational_eligible": False,
            "evaluation": [],
            "status": "unavailable",
        }
    data = json.loads(path.read_text())
    return {
        "operational_eligible": False,
        "evaluation": data["evaluation"],
        "source": data["source"],
        "limitations": data["limitations"],
        "status": "research_only",
        "archive_sha256": data["archive_sha256"],
    }


def executive_report(session, days, zone_view):
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    events = session.exec(
        select(IrrigationEvent).where(
            IrrigationEvent.executed_at >= start.isoformat(),
            IrrigationEvent.executed_at <= now.isoformat(),
        )
    ).all()
    zones = [zone_view(session, z) for z in session.exec(select(Zone)).all()]
    event_recommendations = {e.recommendation_id for e in events}
    recs = [
        r
        for r in session.exec(select(Recommendation)).all()
        if start.isoformat() <= r.created_at <= now.isoformat()
        or r.id in event_recommendations
    ]
    groups, daily = [], {}
    for origin in ["field", "manual", "estimated", "simulation"]:
        rows = [r for r in events if r.origin == origin]
        groups.append(
            {
                "origin": origin,
                "total_l": sum(r.volume_l for r in rows),
                "total_m3": sum(r.volume_l for r in rows) / 1000,
                "events_count": len(rows),
                "measured_l": sum(
                    r.volume_l for r in rows if r.volume_kind == "measured"
                ),
                "estimated_l": sum(
                    r.volume_l for r in rows if r.volume_kind == "estimated"
                ),
            }
        )
        for r in rows:
            day = (
                (datetime.fromisoformat(r.executed_at) + timedelta(hours=3))
                .date()
                .isoformat()
            )
            key = (day, origin)
            daily[key] = daily.get(key, 0) + r.volume_l
    lookup = {z["id"]: z for z in zones}
    proposals = []
    for r in recs:
        z = lookup.get(r.zone_id)
        if (
            z
            and r.revision == z["revision"]
            and r.status in {"suggested", "approved"}
            and z["decision"]["code"] == "review"
        ):
            value = z["decision"]["estimate"]
            if value:
                proposals.append(
                    {
                        "id": r.id,
                        "zone_id": r.zone_id,
                        "origin": z["origin"],
                        "status": r.status,
                        "gross_l": value["gross_l"],
                    }
                )
    summaries = []
    for z in zones:
        d = z["decision"]
        readings = [r for r in z["measurements"] if r.id in d["readings_used"]]
        summaries.append(
            {
                "id": z["id"],
                "name": z["name"],
                "origin": z["origin"],
                "mean_vwc": d["mean_vwc"],
                "valid_readings": len(readings),
                "reading_origins": sorted({r.origin for r in readings}),
                "coverage_fraction": d["coverage"]["fraction"],
                "code": d["code"],
                "decision": d["label"],
                "missing": d["missing"],
                "next_point": d["coverage"]["next_point"],
                "estimated_moisture": None,
            }
        )
    return {
        "generated_at": now.isoformat(),
        "start": start.isoformat(),
        "end": now.isoformat(),
        "days": days,
        "plant_catalog_count": len(session.exec(select(Plant)).all()),
        "groups": groups,
        "events": [r.model_dump() for r in events],
        "daily": [
            {"date": day, "origin": origin, "litres": v}
            for (day, origin), v in sorted(daily.items())
        ],
        "zones": summaries,
        "proposals": proposals,
        "decisions": [
            {
                "id": r.id,
                "zone_id": r.zone_id,
                "status": r.status,
                "created_at": r.created_at,
                "revision": r.revision,
                "outcome": (
                    "recorded_execution"
                    if any(e.recommendation_id == r.id for e in events)
                    else "no_execution_in_period"
                ),
            }
            for r in recs
        ],
        "scenario_water_l": None,
        "savings": savings(0),
        "forecast_quality": research_summary(),
        "sources": [
            public_source(r) for r in session.exec(select(ReferenceSource)).all()
        ],
        "limitations": [
            "لا يوجد خط أساس مقارن متحقق؛ التوفير الفعلي غير متاح",
            "التغطية هندسية وليست نسبة ثقة أو تمثيل زراعي مضمون",
            "القراءات المحاكاة والإدخالات اليدوية ليست قياسات حساسات حية",
            "التوصيات والحسابات غير معتمدة ميدانيًا؛ أكمل القياس والمعايرة",
            "السيناريوهات غير محفوظة ولا تدخل إجمالي الاستهلاك",
            "حالة التربة لقطة حالية؛ الأحداث والقرارات ضمن الفترة المحددة",
        ],
    }
