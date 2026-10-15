"""Display wording must not rewrite stored provenance or change permissions."""
from sqlmodel import Session, select
from app import main
from app.models import Plant, ReferenceSource
from test_api import client, as_role


def test_public_branding_keeps_raw_provenance_and_both_roles(client):
    with Session(main.engine) as session:
        before = [p.model_dump() for p in session.exec(select(Plant)).all()]
        sources = [s.model_dump() for s in session.exec(select(ReferenceSource)).all()]
    obsolete = "grow" + " right"
    assert any(obsolete in p["notes"].lower() for p in before)
    for role in ["user", "survey"]:
        as_role(client, role)
        plants = client.get("/api/plants").json()
        assert len(plants) == len(before) == 5
        for plant in plants:
            for text in [plant["notes"], plant["source"]["title"], plant["source"]["description"]]:
                assert obsolete not in text.lower()
            assert plant["source_id"] == next(p["source_id"] for p in before if p["id"] == plant["id"])
        for zone in client.get("/api/zones").json():
            assert obsolete not in zone["plant"]["notes"].lower()
        report = client.get("/api/reports/executive?days=7").json()
        assert report["plant_catalog_count"] == len(before)
        assert len(report["zones"]) == 5
        for source in report["sources"]:
            assert obsolete not in (source["title"] + source["description"]).lower()
    with Session(main.engine) as session:
        assert before == [p.model_dump() for p in session.exec(select(Plant)).all()]
        assert sources == [s.model_dump() for s in session.exec(select(ReferenceSource)).all()]
