"""Public provenance wording; historical database records and identifiers stay intact."""


def public_source(source):
    if source is None:
        return None
    data = source.model_dump()
    if source.id == "grow-right":
        data["title"] = "ملفات نباتية داخلية للفريق"
        data["description"] = (
            "مرجع داخلي غير موثق خارجيًا؛ استُخدمت منه أسماء نباتات الموقع فقط، "
            "ولا تدخل ملاءمته في حساب الري."
        )
    return data


def public_plant(plant):
    if plant is None:
        return None
    data = plant.model_dump()
    if plant.source_id == "grow-right":
        data["notes"] = (
            "اسم مستفاد من ملفات نباتية داخلية للفريق. ملف النبات الأصلي ليس "
            "مرجعًا زراعيًا معتمدًا؛ دليل العناية الموثق طبقة معلومات مستقلة."
        )
    return data
