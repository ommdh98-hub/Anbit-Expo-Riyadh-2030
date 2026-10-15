"use client";
import { display } from "../lib/i18n";
import DecisionExplanation from "./decision-explanation";
import { useRef } from "react";
import { Zone } from "../lib/types";
import { date, number } from "../lib/api";

// Presentation only: official classification and exclusions always come from the API.
export function simpleState(zone: Zone) {
  const d = zone.decision;
  const allOld =
    d.code === "insufficient" &&
    !d.readings_used.length &&
    d.rejected.length > 0 &&
    d.rejected.every((r) => {
      const m = zone.measurements.find((m) => m.id === r.id);
      return (
        r.reason.includes("قديمة") &&
        m &&
        Date.parse(m.measured_at) < Date.parse(d.evaluated_at)
      );
    });
  if (allOld)
    return {
      title: "القراءات قديمة",
      text: "القراءات الموجودة قديمة. نحتاج قياسًا جديدًا قبل تقييم الري.",
    };
  const labels: Record<string, { title: string; text: string }> = {
    measure: {
      title: "تحتاج قياسًا إضافيًا",
      text: "نحتاج قياسات من أجزاء أخرى من المنطقة قبل تقييم الري.",
    },
    conflict: {
      title: "القراءات مختلفة وتحتاج فحصًا",
      text: "تختلف القراءات بدرجة تستدعي التحقق منها قبل اتخاذ قرار.",
    },
    high: {
      title: "رطوبة أعلى من الحد المحدد",
      text: "أجّل الري وراجع سبب ارتفاع الرطوبة والصرف.",
    },
    review: {
      title: "رطوبة أقل من الحد المحدد",
      text: "الرطوبة أقل من الحد المحدد للمنطقة؛ راجع التوصية قبل أي تنفيذ.",
    },
    defer: {
      title: "رطوبة ضمن النطاق المحدد",
      text: "الرطوبة ضمن النطاق المحدد للمنطقة. تابع القياس.",
    },
  };
  if (labels[d.code]) return labels[d.code];
  if (d.rejected.some((r) => r.reason.includes("سابقة لآخر")))
    return {
      title: "نحتاج قياسًا بعد الري",
      text: "القراءات السابقة للري لا تصف الحالة بعده. أضف قراءة جديدة.",
    };
  return {
    title: "نحتاج معلومات إضافية",
    text: d.readings_used.length
      ? "القراءات وحدها لا تكفي؛ راجع المتطلبات الناقصة قبل تقييم الري."
      : "نحتاج قراءات رطوبة حديثة وموثوقة. راجع أسباب استبعاد القراءات في التفاصيل.",
  };
}

export default function GuidedEvaluation({
  zones,
  zone,
  step,
  chosen,
  onStep,
  onChoose,
  onReading,
  onTwin,
  onOperations,
  busy,
  feedback,
  canMeasure = true,
  homeMode = false,
}: {
  zones: Zone[];
  zone: Zone;
  step: 1 | 2 | 3;
  chosen: boolean;
  onStep: (step: 1 | 2 | 3) => void;
  onChoose: (id: string) => void;
  onReading: () => void;
  onTwin: () => void;
  onOperations: () => void;
  busy: boolean;
  feedback: string;
  canMeasure?: boolean;
  homeMode?: boolean;
}) {
  const selection = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const status = simpleState(zone),
    d = zone.decision;
  const needs = ["insufficient", "measure", "conflict"].includes(d.code);
  const allOld =
    zones.length > 0 &&
    zones.every((z) => simpleState(z).title === "القراءات قديمة");
  const titles = [
    "١. اختر المنطقة",
    "٢. افحص رطوبة التربة",
    "٣. شاهد التوصية",
  ] as const;
  function navigate(next: 1 | 2 | 3) {
    onStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return (
    <section
      className="guided-evaluation"
      aria-label={display("تقييم منطقة في ثلاث خطوات")}
    >
      {display(
        step === 1 && (
          <div className="guide-intro">
            <p>
              {display(
                " أنبت يساعدك على معرفة أين تحتاج إلى قياس التربة، وهل تتوفر معلومات كافية لاتخاذ قرار الري. ",
              )}
            </p>
            <button
              className="primary"
              onClick={() => {
                selection.current?.focus();
                selection.current?.scrollIntoView({
                  block: "center",
                  behavior: "smooth",
                });
              }}
            >
              {display(" ابدأ تقييم منطقة ")}
            </button>
            <small>
              {display(" موقع تجريبي · القراءات المدخلة هنا بيانات محاكاة ")}
            </small>
          </div>
        ),
      )}
      <nav className="guide-steps" aria-label={display("خطوات تقييم المنطقة")}>
        {display(
          titles.map((title, i) => (
            <button
              key={title}
              aria-current={step === i + 1 ? "step" : undefined}
              disabled={busy || (i > 0 && !chosen)}
              onClick={() => navigate((i + 1) as 1 | 2 | 3)}
            >
              {display(title)}
            </button>
          )),
        )}
      </nav>
      {display(
        step === 1 ? (
          <section>
            <h2 ref={selection} tabIndex={-1}>
              {display(" اختر المنطقة التي تريد تقييمها ")}
            </h2>
            {display(
              allOld && (
                <p className="guide-stale">
                  {display(
                    " القراءات الحالية قديمة، لذلك لا يستطيع أنبت تقييم المناطق بشكل موثوق. اختر منطقة لإضافة قياس جديد؛ لم نغيّر القراءات المحفوظة. ",
                  )}
                </p>
              ),
            )}
            <div className="guide-zone-list">
              {display(
                zones.map((z) => {
                  const s = simpleState(z);
                  return (
                    <article key={z.id}>
                      <div>
                        <h3>{display(z.name)}</h3>
                        <strong>{display(s.title)}</strong>
                        <p>{display(s.text)}</p>
                      </div>
                      <button
                        aria-label={display(`اختر ${z.name}`)}
                        onClick={() => {
                          onChoose(z.id);
                          requestAnimationFrame(() => heading.current?.focus());
                        }}
                      >
                        {display(" اختر المنطقة ← ")}
                      </button>
                    </article>
                  );
                }),
              )}
            </div>
          </section>
        ) : (
          <section className="panel guide-panel">
            <small>
              {display(zone.name)} · {display(zone.plant?.name)}
            </small>
            <h2 ref={heading} tabIndex={-1}>
              {display(titles[step - 1])}
            </h2>
            {display(
              feedback && (
                <p className="guide-feedback" role="status">
                  {display(feedback)}
                </p>
              ),
            )}
            <h3>{display(status.title)}</h3>
            <p className="guide-summary">{display(status.text)}</p>
            {display(
              step === 2 ? (
                <>
                  <p>
                    {display(
                      d.readings_used.length
                        ? `توجد قراءات صالحة في ${number(d.coverage.active_points)} نقاط؛ صلاحية القراءة وحدها لا تعني كفاية المعلومات.`
                        : "لا توجد قراءة حالية صالحة للتقييم.",
                    )}
                  </p>
                  <div className="guide-location">
                    <strong>{display(" أين أقيس؟ ")}</strong>
                    <p>{display(d.coverage.next_point.reason)}</p>
                    <p>
                      {display(" الموقع المقترح: س ")}
                      {display(number(d.coverage.next_point.x))}
                      {display(" ، ص ")}
                      {display(" ")}
                      {display(number(d.coverage.next_point.y))}
                      {display(" متر داخل مخطط الموقع، وليس GPS. ")}
                    </p>
                    <button onClick={onTwin}>
                      {display(" شاهد الموقع في التوأم الرقمي ")}
                    </button>
                  </div>
                  <p>
                    {display(
                      " أضف قيمة قرأتها في الموقع المقترح. قد نحتاج أكثر من قراءة؛ سنعيد التقييم بعد كل حفظ. ",
                    )}
                  </p>
                  <div className="guide-actions">
                    {display(
                      canMeasure ? (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={onReading}
                        >
                          {display(" إضافة قراءة تربة ")}
                        </button>
                      ) : (
                        <span className="anbit-role-hint">
                          {display(
                            " إضافة القياسات من اختصاص فرق المسطحات الخضراء. ",
                          )}
                        </span>
                      ),
                    )}
                    <button onClick={() => navigate(3)}>
                      {display(" شاهد التوصية الحالية ")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    <strong>{display(" السبب: ")}</strong>
                    {display(d.reason)}
                  </p>
                  {display(
                    d.mean_vwc !== null && (
                      <p>
                        {display(" متوسط رطوبة القراءات الصالحة: ")}
                        {display(number(d.mean_vwc * 100))}
                        {display(
                          " % حجمية. هذا متوسط نقاط القياس، وليس قياسًا لكل أجزاء المنطقة. ",
                        )}
                      </p>
                    ),
                  )}
                  <DecisionExplanation
                    emptyLabel={homeMode ? "أكمل الإعدادات" : undefined}
                    compact={homeMode}
                    key={zone.id + d.evaluated_at}
                    zone={zone}
                  />
                  <div className="guide-actions">
                    <button
                      className="primary"
                      onClick={() => (needs ? navigate(2) : onOperations())}
                    >
                      {display(
                        needs
                          ? "العودة لإكمال القياس"
                          : "مراجعة إجراءات التوصية",
                      )}
                    </button>
                    <button onClick={onTwin}>
                      {display(" استعرض التوأم الرقمي ")}
                    </button>
                  </div>
                  <p className="footnote">
                    {display(
                      " تجربة سيناريو الري اختيارية داخل التوأم. نتيجتها افتراضية ولا تحفظ كقراءة أو تنفيذ. ",
                    )}
                  </p>
                </>
              ),
            )}
            <details className="guide-explanation">
              <summary>{display(" كيف وصل أنبت إلى هذه النتيجة؟ ")}</summary>
              <p>
                {display(" القرار الرسمي: ")}
                {display(d.label)}. {display(d.validity)}
              </p>
              <p>
                {display(" التغطية الهندسية ")}
                {display(number(d.coverage.fraction * 100))}
                {display(" %؛ حد العرض ")}
                {display(" ")}
                {display(number(d.coverage.required_fraction * 100))}
                {display(" %، نصف القطر ")}
                {display(" ")}
                {display(number(d.coverage.radius_m))}
                {display(" م. ")}
                {display(d.coverage.method)}
                {display(" ")}
                {display(d.coverage.caveat)}
              </p>
              <p>
                {display(" المتطلبات الناقصة: ")}
                {display(" ")}
                {display(d.missing.join("، ") || "لا توجد وفق قواعد العرض")}
              </p>
              <p>
                {display(" قواعد القرار: ")}
                {display(d.rules.join("، "))}
              </p>
              <p>
                {display(" حدود التربة الحجمية: ")}
                {display(" ")}
                {display(
                  zone.soil
                    ? `${number(zone.soil.lower_vwc * 100)}% أدنى، ${number(zone.soil.target_vwc * 100)}% مستهدف، ${number(zone.soil.upper_vwc * 100)}% أعلى؛ المعايرة: ${zone.soil.calibration}`
                    : homeMode
                      ? "أكمل الإعدادات"
                      : "غير متوفرة",
                )}
              </p>
              <p>
                {display(" منشأ المنطقة: ")}
                {display(" ")}
                {display(zone.origin === "simulation" ? "محاكاة" : zone.origin)}
                {display(" . المصادر المستخدمة: ")}
                {display(d.sources.join("، ") || "لا قراءات مستخدمة")}.
              </p>
              <p>
                {display(" افتراضات المنطقة: مساحة ري ")}
                {display(" ")}
                {display(
                  zone.irrigated_area_m2 === null
                    ? homeMode
                      ? "أكمل الإعدادات"
                      : "غير متوفرة"
                    : number(zone.irrigated_area_m2),
                )}
                {display(" ")}
                {display(" م²؛ عمق ")}
                {display(" ")}
                {display(
                  zone.root_depth_m === null
                    ? homeMode
                      ? "أكمل الإعدادات"
                      : "غير متوفر"
                    : number(zone.root_depth_m),
                )}
                {display(" ")}
                {display(" م؛ كفاءة ")}
                {display(" ")}
                {display(
                  zone.efficiency === null
                    ? homeMode
                      ? "أكمل الإعدادات"
                      : "غير متوفرة"
                    : number(zone.efficiency * 100) + "%",
                )}
                . {display(d.caveats.join(" "))}
              </p>
              {display(d.estimate && <p>{display(d.estimate.formula)}</p>)}
              <h3>
                {display(" القراءات المستخدمة ( ")}
                {display(d.readings_used.length)})
              </h3>
              {display(
                zone.measurements
                  .filter((m) => d.readings_used.includes(m.id))
                  .map((m) => (
                    <p key={m.id}>
                      {display(
                        zone.points.find((p) => p.id === m.point_id)?.name ??
                          m.point_id,
                      )}
                      : {display(number(m.value))} {display(m.unit)} ·{" "}
                      {display(date(m.measured_at))}
                      {display(" · المصدر ")}
                      {display(" ")}
                      {display(m.source)}
                      {display(" · الجودة ")}
                      {display(m.quality)}
                      {display(" · المنشأ ")}
                      {display(m.origin)}
                    </p>
                  )),
              )}
              <h3>
                {display(" القراءات المستبعدة ( ")}
                {display(d.rejected.length)})
              </h3>
              {display(
                d.rejected.map((r) => {
                  const m = zone.measurements.find((m) => m.id === r.id);
                  return (
                    <p key={r.id}>
                      {display(
                        m
                          ? `${zone.points.find((p) => p.id === m.point_id)?.name ?? m.point_id} · ${number(m.value)} ${m.unit} · ${date(m.measured_at)} · ${m.source} · ${m.quality} · ${m.origin}`
                          : r.id,
                      )}
                      : {display(r.reason)}
                    </p>
                  );
                }),
              )}
              <button onClick={onOperations}>
                {display(" افتح سجل المنطقة وجميع الإجراءات ")}
              </button>
            </details>
          </section>
        ),
      )}
    </section>
  );
}
