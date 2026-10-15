"use client";
import { display } from "../lib/i18n";
import DecisionExplanation from "./decision-explanation";
import { FormEvent, useRef, useState } from "react";
import { api, post, number, date } from "../lib/api";
import { Zone, Recommendation } from "../lib/types";
import { theoreticalDuration } from "../lib/planning";

type Result = {
  inputs: { volume_l: number; efficiency: number };
  baseline_vwc: number;
  baseline_origin: string;
  baseline_sources: string[];
  baseline_timestamps: string[];
  effective_volume_l: number;
  applied_depth_mm: number;
  effective_depth_mm: number;
  delta_vwc: number;
  scenario_vwc: number;
  exceeds_volume_limit: boolean;
  formula: string;
  limitations: string;
};
const originLabel: Record<string, string> = {
  simulation: "بيانات محاكاة",
  manual: "إدخال يدوي",
  field: "قياس ميداني",
  estimated: "تقدير",
  user_hypothesis: "بداية افتراضية أدخلها المستخدم",
};

export default function DigitalTwin({
  zone,
  recommendation,
  onReading,
  onDetails,
  canMeasure = true,
}: {
  zone: Zone;
  recommendation?: Recommendation;
  onReading: () => void;
  onDetails: () => void;
  canMeasure?: boolean;
}) {
  const d = zone.decision,
    c = d.coverage;
  const usable = zone.measurements.filter((m) =>
    d.readings_used.includes(m.id),
  );
  const latest = usable[0];
  const statuses: Record<string, string> = {
    suggested: "مقترح",
    approved: "معتمد",
    deferred: "مؤجل",
    executed: "منفّذ",
  };
  return (
    <section className="twin-layout">
      <Scenario key={zone.id + ":" + zone.revision} zone={zone} />
      <details className="twin-advanced">
        <summary>{display("تفاصيل القياسات والقرار والافتراضات")}</summary>
        <div className="panel twin-state">
          <span className="eyebrow">
            {display(" حالة المنطقة الحالية · بيانات محفوظة ")}
          </span>
          <h2>{display(zone.name)}</h2>
          <p>
            {display(zone.plant?.name ?? "نبات غير متوفر")} ·{" "}
            {display(number(zone.area_m2))}
            {display(" م² · ")}
            {display(" ")}
            {display(zone.soil?.name ?? "تربة غير متوفرة")} ·{" "}
            {display(zone.method)}
          </p>
          <span className={`status ${d.code}`}>{display(d.label)}</span>
          <p>{display(d.reason)}</p>
          <p>
            {display(
              d.missing.length
                ? `متطلبات ناقصة: ${d.missing.join(" · ")}`
                : "لا متطلبات ناقصة وفق قواعد العرض",
            )}
          </p>
          <p>
            {display(" حالة التوصية: ")}
            {display(" ")}
            {display(
              recommendation
                ? statuses[recommendation.status]
                : "لا توجد توصية حالية",
            )}
          </p>
          <DecisionExplanation key={zone.id + d.evaluated_at} zone={zone} />
          <h3>{display(" القياسات والتغطية المحسوبة ")}</h3>
          <p>
            {display(" أحدث قراءة صالحة: ")}
            {display(" ")}
            {display(
              latest
                ? `${number(latest.unit === "vwc_fraction" ? latest.value * 100 : latest.value)} % حجمية — ${date(latest.measured_at)} — ${latest.source} — متحققة — ${originLabel[latest.origin]}`
                : "غير متوفرة",
            )}
          </p>
          <p>
            {display(c.active_points)}
            {display(" نقاط صالحة · تغطية ")}
            {display(number(c.fraction * 100))}
            {display(" % · الحد التجريبي ")}
            {display(number(c.required_fraction * 100))}%
          </p>
          <p>
            {display(c.method)}
            {display(" نصف قطر العرض: ")}
            {display(number(c.radius_m))}
            {display(" م. ")}
            {display(c.caveat)}
          </p>
          <details>
            <summary>
              {display(" تفاصيل نقاط القياس والقراءات ( ")}
              {display(zone.points.length)})
            </summary>
            {display(
              zone.points.map((p) => {
                const m = zone.measurements.find((r) => r.point_id === p.id);
                const rejected = m && d.rejected.find((r) => r.id === m.id);
                return (
                  <div className="twin-point" key={p.id}>
                    <strong>
                      {display(p.name)} · ({display(number(p.x))}
                      {display(" ، ")}
                      {display(number(p.y))}
                      {display(" ) م ")}
                    </strong>
                    <p>
                      {display(
                        m
                          ? `${number(m.value)} ${m.unit} · ${date(m.measured_at)} · ${m.source} · ${originLabel[m.origin] ?? m.origin} · الجودة: ${m.quality}`
                          : "لا توجد قراءة",
                      )}
                    </p>
                    <small>
                      {display(
                        rejected?.reason ??
                          (m && d.readings_used.includes(m.id)
                            ? "صالحة ضمن قواعد العرض"
                            : "غير صالحة للقرار"),
                      )}
                    </small>
                  </div>
                );
              }),
            )}
          </details>
          <p>
            {display(" قراءات مستبعدة من أحدث قراءات النقاط: ")}
            {display(d.rejected.length)}
          </p>
          <h3>{display(" الفحص التالي المقترح ")}</h3>
          <p>
            ({display(number(c.next_point.x))}
            {display(" ، ")}
            {display(number(c.next_point.y))}
            {display(" ) متر محلي. ")}
            {display(" ")}
            {display(c.next_point.reason)}
          </p>
          <div className="twin-actions">
            {display(
              canMeasure && (
                <button className="primary" onClick={onReading}>
                  {display(" إضافة قراءة في النقطة المقترحة ")}
                </button>
              ),
            )}
            <button onClick={onDetails}>
              {display(" تفاصيل المنطقة والقرارات ")}
            </button>
          </div>
          <p className="footnote">
            {display(
              " حرارة التربة: غير متوفرة · حرارة الجو: غير متوفرة · الأمطار: غير متوفرة · حساسات متصلة: غير متوفرة · تنبؤ ML: غير متاح ",
            )}
          </p>
        </div>
      </details>
    </section>
  );
}

function Scenario({ zone }: { zone: Zone }) {
  const [mode, setMode] = useState("stored"),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [flow, setFlow] = useState<number | null>(null);
  const request = useRef(0);
  const available =
    ["review", "high", "defer"].includes(zone.decision.code) &&
    zone.root_representative;
  function clear() {
    request.current++;
    setResult(null);
    setError("");
    setBusy(false);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setFlow(f.get("flow") ? Number(f.get("flow")) : null);
    const token = ++request.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await api<Result>(
        `/zones/${zone.id}/simulate`,
        post({
          volume_l: Number(f.get("volume")),
          baseline_mode: mode,
          ...(mode === "hypothetical"
            ? { starting_vwc: Number(f.get("start")) / 100 }
            : {}),
          irrigated_area_m2: Number(f.get("area")),
          root_depth_m: Number(f.get("depth")),
          efficiency: Number(f.get("efficiency")),
        }),
      );
      if (token === request.current) setResult(r);
    } catch (e) {
      if (token === request.current)
        setError(e instanceof Error ? e.message : "تعذر الحساب");
    } finally {
      if (token === request.current) setBusy(false);
    }
  }
  return (
    <div className="panel twin-scenario">
      <span className="eyebrow">
        {display(" تجربة سيناريو · لا تحفظ في السجلات ")}
      </span>
      <h2>{display("ماذا يحدث إذا روينا هذه المنطقة بهذه الكمية؟")}</h2>
      <p>
        {display(
          " النتيجة الافتراضية توضيح حسابي فوري، وليست توقعًا لما سيقيسه حساس أو تصريحًا بالري. ",
        )}
      </p>
      <form
        onSubmit={submit}
        onChange={clear}
        onReset={() => {
          clear();
          setMode("stored");
        }}
      >
        <label>
          {display(" مصدر رطوبة البداية ")}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="stored">
              {display(" متوسط القراءات المحفوظة الصالحة ")}
            </option>
            <option value="hypothetical">
              {display(" بداية افتراضية أدخلها بنفسي ")}
            </option>
          </select>
        </label>
        {display(
          mode === "stored" ? (
            <p>
              {display(
                available
                  ? `متوسط ${number((zone.decision.mean_vwc ?? 0) * 100)}% — ${originLabel[zone.origin]}. تمثيل العمق والتجانس وفق إعدادات المنطقة.`
                  : "بيانات غير كافية لخط بداية ممثل. أكمل القياس أو اختر بداية افتراضية.",
              )}
            </p>
          ) : (
            <label>
              {display(" رطوبة بداية افتراضية (% حجمية) ")}
              <input
                name="start"
                type="number"
                min="0"
                max="100"
                step="any"
                required
              />
            </label>
          ),
        )}
        <div className="twin-inputs">
          <label>
            {display(" كمية ري افتراضية (لتر) ")}
            <input
              name="volume"
              type="number"
              min="0"
              max="1000000"
              step="any"
              defaultValue="0"
              required
            />
          </label>
          <label>
            {display("التدفق (لتر/ساعة) — اختياري")}
            <input name="flow" type="number" min="0.000001" step="any" />
          </label>
        </div>
        <details
          open={
            !zone.irrigated_area_m2 || !zone.root_depth_m || !zone.efficiency
          }
        >
          <summary>
            {display("المساحة والعمق والكفاءة — إعدادات المنطقة")}
          </summary>
          <div className="twin-inputs">
            <label>
              {display(" مساحة ري مفترضة (م²) ")}
              <input
                name="area"
                type="number"
                min="0.000001"
                max={zone.area_m2}
                step="any"
                defaultValue={zone.irrigated_area_m2 ?? ""}
                required
              />
            </label>
            <label>
              {display(" عمق جذور مفترض (م) ")}
              <input
                name="depth"
                type="number"
                min="0.000001"
                max="3"
                step="any"
                defaultValue={zone.root_depth_m ?? ""}
                required
              />
            </label>
            <label>
              {display(" كفاءة ري مفترضة (0–1) ")}
              <input
                name="efficiency"
                type="number"
                min="0.000001"
                max="1"
                step="any"
                defaultValue={zone.efficiency ?? ""}
                required
              />
            </label>
          </div>
        </details>
        <p className="footnote">
          {display(
            " المساحة والعمق والكفاءة قيم سيناريو قابلة للتعديل؛ قيم العرض الأولية افتراضات وليست قياسات. الحقول المفقودة تبقى فارغة. ",
          )}
        </p>
        <div className="twin-actions">
          <button
            className="primary"
            disabled={busy || (mode === "stored" && !available)}
          >
            {display(busy ? "جارٍ الحساب…" : "احسب النتيجة الافتراضية")}
          </button>
          <button type="reset">{display(" إعادة تعيين السيناريو ")}</button>
        </div>
      </form>
      {display(error && <p role="alert">{display(error)}</p>)}
      {display(
        result && (
          <div className="twin-result" role="status">
            <h3>{display(" النتيجة الافتراضية — للعرض فقط ")}</h3>
            <div className="twin-compare">
              <div>
                <small>
                  {display(" خط البداية · ")}
                  {display(originLabel[result.baseline_origin])}
                </small>
                <strong>{display(number(result.baseline_vwc * 100))}%</strong>
              </div>
              <div>
                <small>{display(" بعد إضافة الماء نظريًا ")}</small>
                <strong>
                  {result.exceeds_volume_limit
                    ? display("خارج النطاق الفيزيائي")
                    : `${number(result.scenario_vwc * 100)}%`}
                </strong>
              </div>
            </div>
            {result.exceeds_volume_limit && (
              <p role="alert">
                {display(
                  "النتيجة تتجاوز 100% حجمية؛ خفّض الماء أو راجع المساحة والعمق. ليست حالة تربة ممكنة.",
                )}
              </p>
            )}
            <p>
              {display("الكمية المقدرة للوصول إلى الهدف")}:{" "}
              {mode === "stored" &&
              zone.decision.code === "review" &&
              zone.decision.estimate
                ? `${number(zone.decision.estimate.gross_l)} ${display("لتر")}`
                : display("غير متاح")}{" "}
              · {display("تقدير المحرك الحالي وفق افتراضات المنطقة")}
            </p>
            <p>
              {display("مدة الري")}:{" "}
              {theoreticalDuration(result.inputs.volume_l, flow) === null
                ? display("التدفق غير معروف")
                : `${number(theoreticalDuration(result.inputs.volume_l, flow)!)} ${display("ساعة")}`}
            </p>
            <p>
              {display("موعد الري القادم")}:{" "}
              {display(
                "غير متاح دون توقع موثق؛ جرّب التخطيط الافتراضي في الرئيسية",
              )}
            </p>
            <details>
              <summary>{display("تفاصيل الموازنة والحدود")}</summary>
              <p>
                {display(" تغير الرطوبة: ")}
                {display(number(result.delta_vwc * 100))}
                {display(" نقطة مئوية. ماء فعال: ")}
                {display(" ")}
                {display(number(result.effective_volume_l))}
                {display(" لتر. ")}
              </p>
              <p>
                {display(" عمق ماء مطبق: ")}
                {display(number(result.applied_depth_mm))}
                {display(" مم؛ الفعال: ")}
                {display(" ")}
                {display(number(result.effective_depth_mm))}
                {display(" مم. ")}
              </p>
              <p>
                {display(" مصدر البداية: ")}
                {display(" ")}
                {display(
                  result.baseline_sources.join("، ") ||
                    "إدخال افتراضي؛ ليس قياسًا",
                )}
                {display(
                  result.baseline_timestamps.length > 0 &&
                    ` · أوقات القراءات: ${result.baseline_timestamps.map(date).join("، ")}`,
                )}
              </p>
              {display(
                result.exceeds_volume_limit && (
                  <p role="alert">
                    {display(
                      " النتيجة تتجاوز 100% حجمية وغير ممكنة فيزيائيًا؛ لم تُقص أو تُفسر كصرف. خفّض الماء أو راجع الافتراضات. ",
                    )}
                  </p>
                ),
              )}
              <p>
                {display(" حدود إدارة التربة ")}
                {display(" ")}
                {display(
                  zone.soil?.calibration === "demo_assumption"
                    ? "(افتراضات عرض)"
                    : "(وفق الملف المحفوظ)",
                )}
                :{display(" ")}
                {display(
                  zone.soil
                    ? `${number(zone.soil.lower_vwc * 100)}% أدنى، ${number(zone.soil.target_vwc * 100)}% مستهدف، ${number(zone.soil.upper_vwc * 100)}% أعلى`
                    : "غير متوفرة",
                )}
                {display(" . ليست حدود تشبع. ")}
              </p>
              <code dir="ltr">{display(result.formula)}</code>
              <p>
                {display(" 1 لتر/م² = 1 مم. نضيف ΔVWC إلى كسر رطوبة البداية. ")}
              </p>
              <p>{display(result.limitations)}</p>
            </details>
            <strong>
              {display(" لم تتغير القراءات أو التوصية أو تقرير المياه. ")}
            </strong>
          </div>
        ),
      )}
    </div>
  );
}
