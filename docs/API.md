# API أنبت

المرجع الكامل القابل للتجربة: `http://127.0.0.1:8000/docs`، والمخطط المحفوظ `docs/openapi.json`.

| المسار | الوظيفة |
|---|---|
| GET /api/health | اتصال التطبيق وقاعدة البيانات |
| GET /api/sites | المواقع |
| GET /api/zones?site_id=demo | المناطق وتقييماتها الحالية |
| GET /api/zones/{id} | المنطقة والنقاط والقراءات والتوصية المحسوبة |
| GET/POST /api/zones/{id}/measurements | قراءة/حفظ قياس |
| GET /api/zones/{id}/coverage | التغطية والفجوات |
| GET /api/zones/{id}/next-measurement | الموقع التالي ضمن تحليل التغطية |
| POST /api/zones/{id}/recommendations | حفظ توصية أو إعادة القائمة الحالية |
| GET /api/recommendations | سجل التوصيات |
| PATCH /api/recommendations/{id} | approved أو deferred، مع operator |
| POST /api/zones/{id}/estimate | تجربة افتراضات محاكاة دون حفظها |
| GET/POST /api/irrigation-events | قراءة/تسجيل تنفيذ بعد اعتماد صالح |
| GET/POST /api/zones/{id}/inspections | سجل الفحص |
| GET /api/reports/water?origin=simulation&days=7 | التقارير المفصولة حسب المنشأ |
| GET /api/plants | النباتات ومصدرها وحدود المعلومات |
| POST /api/demo/reset | صيانة منفصلة لموقع المحاكاة؛ محظورة افتراضيًا على الجمهورين |

مثال قراءة (استبدل الوقت بوقت صالح مع المنطقة الزمنية، والمعرف بـUUID جديد):

```json
{
  "id": "reading-example-001",
  "point_id": "z1-p1",
  "value": 15,
  "unit": "vwc_percent",
  "measured_at": "2026-10-12T18:00:00+00:00",
  "source": "قياس يدوي ضمن المحاكاة",
  "operator": "عضو الفريق",
  "quality": "verified",
  "origin": "simulation"
}
```

بدل point_id أرسل x وy بالمتر داخل حدود المنطقة لإنشاء نقطة جديدة. الوحدات المقبولة vwc_percent وvwc_fraction وraw؛ الخام محفوظ لكنه غير صالح لحساب الرطوبة أو كمية المياه. منشأ simulation لا يختلط بمواقع field/manual/estimated، والقياس المتحقق خارج المحاكاة يحتاج evidence. لا توجد واجهة تشغيل ميداني في هذه النسخة.

الأخطاء: 404 مرجع مفقود، 422 تحقق مدخلات أو انتقال غير مسموح، 409 تكرار أو توصية متقادمة/مغلقة. يرسل العميل معرف عملية فريدًا للحفظ؛ تكراره يعيد 409. أحداث الري لا تتكرر للتوصية نفسها. استجابات القرار تحتوي القراءات المستخدمة والمستبعدة والقواعد والمصادر والنقص والصلاحية والتقدير المشروط.

## السيناريو المعزول

`POST /api/zones/{id}/simulate` لا يحفظ أو يغيّر القرار. مثال أحواض الأعشاب:

```json
{"volume_l":1000,"baseline_mode":"stored","irrigated_area_m2":400,"root_depth_m":0.2,"efficiency":0.8}
```

`stored` يستخرج المتوسط الصالح من الخادم ويرفض إرسال starting_vwc. عند عدم كفاية البداية يعيد 422. لوضع افتراضي مستقل أرسل baseline_mode=hypothetical وstarting_vwc ككسر [0،1]. جميع القيم محدودة وغير NaN/Infinity. المساحة والعمق موجبان والكفاءة (0،1]. 404 لمنطقة غير موجودة.

الاستجابة: baseline_vwc والمنشأ والمصادر ومعرفات/أوقات القراءات، المدخلات، applied_depth_mm وeffective_depth_mm وeffective_volume_l وdelta_vwc وscenario_vwc، وعلامة exceeds_volume_limit، وحدود التربة وشرح المعادلة والقيود. فوق 100% يُعلّم دون قص أو ادعاء صرف. [تفاصيل الافتراضات](DIGITAL_TWIN.md).

## صلاحيات الجمهورين

جميع عمليات القراءة والحساب غير المحفوظ متاحة بعد تسجيل الدخول. عمليات حفظ القياسات والفحوصات والتوصيات والاعتماد والتنفيذ متاحة فقط لـ`survey` (فرق المسطحات الخضراء)، وتعيد 403 لـ`user` (الأفراد). إعادة الضبط تتطلب تفويض صيانة منفصلًا ولا يجيزها اختيار أي دور. [المصفوفة الكاملة](AUDIENCES_AND_PERMISSIONS.md).


## التخطيط التنبؤي الآمن

- `POST /api/zones/{id}/plan`: حساب سيناريو غير دائم لفرق المسطحات فقط. ملف التربة والطقس المفترض ضمن الطلب؛ المرجع الدقيق `backend/app/planning.py::PlanInput`. البداية المحفوظة لا تتجاوز بوابات المحرك. دائمًا `operational_eligible=false` و`persisted=false` و`hardware_triggered=false`.
- `GET /api/zones/{id}/spatial`: IDW تجريبي مع دعم مكاني وفجوات؛ لا استيراد كقياس.
- `GET /api/reports/executive?days=7`: مجموع منفصل لكل مصدر ولقطة التربة وقرارات الفترة؛ لا وفر مثبت ولا جمع للسيناريو.
- `GET /api/research/forecast`: نتائج البحث المقاسة فقط؛ لا استدلال تشغيلي.

التفاصيل ومصادر الافتراضات وإعادة الإنتاج: [PREDICTIVE_IRRIGATION.md](PREDICTIVE_IRRIGATION.md).
