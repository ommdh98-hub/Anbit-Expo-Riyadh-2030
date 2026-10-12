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
| POST /api/demo/reset | إعادة موقع المحاكاة فقط |

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
