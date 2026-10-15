"use client";
import { FormEvent, useRef, useState, useSyncExternalStore } from "react";
import { display as t } from "../lib/i18n";
import { api, post, number, date } from "../lib/api";
import type { Zone, Report } from "../lib/types";
import type {
  ForecastPoint,
  Plan,
  Profile,
  Research,
  Spatial,
} from "../lib/planning";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("anbit-profile", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("anbit-profile", callback);
  };
}
function profileKey(id: string) {
  return `anbit-planning-profile-v1:${id}`;
}
function savedProfile(id: string) {
  try {
    return window.localStorage.getItem(profileKey(id)) ?? "";
  } catch {
    return "";
  }
}
export function ForecastChart({
  points,
  scheduled,
  threshold,
  event,
}: {
  points: ForecastPoint[];
  scheduled?: ForecastPoint[];
  threshold: number;
  event?: { hour: number; duration_hours: number | null };
}) {
  const values = [...points, ...(scheduled ?? [])].flatMap((r) => [
    r.low,
    r.high,
  ]);
  const minimum = Math.max(
    0,
    Math.floor(Math.min(threshold, ...values) * 100 - 2) / 100,
  );
  const maximum = Math.min(
    1,
    Math.ceil(Math.max(threshold, ...values) * 100 + 2) / 100,
  );
  const y = (v: number) =>
    165 - ((v - minimum) / Math.max(0.05, maximum - minimum)) * 145;
  const x = (h: number) => 38 + (h / 24) * 500;
  const line = (rows: ForecastPoint[], field: "vwc" | "low" | "high") =>
    rows.map((r) => `${x(r.hour)},${y(r[field])}`).join(" ");
  return (
    <figure className="forecast-chart">
      <svg
        viewBox="0 0 570 200"
        role="img"
        aria-label={t("الرطوبة المتوقعة خلال 24 ساعة — محاكاة وليست قياسًا")}
      >
        {[0, 1, 2, 3, 4]
          .map((i) => minimum + ((maximum - minimum) * i) / 4)
          .map((v) => (
            <g key={v}>
              <line
                x1="38"
                x2="538"
                y1={y(v)}
                y2={y(v)}
                className="grid-line"
              />
              <text x="30" y={y(v) + 4} textAnchor="end">
                {number(v * 100)}%
              </text>
            </g>
          ))}
        <polygon
          points={`${line(points, "high")} ${line([...points].reverse(), "low")}`}
          className="forecast-band"
        />
        {event && (
          <rect
            className="schedule-window"
            x={x(event.hour)}
            y="20"
            width={Math.max(
              3,
              x(Math.min(24, event.hour + (event.duration_hours ?? 0.2))) -
                x(event.hour),
            )}
            height="145"
          >
            <title>
              {t("نافذة تطبيق افتراضية؛ المدة حسب التدفق عند توفره")}
            </title>
          </rect>
        )}
        <line
          x1="38"
          x2="538"
          y1={y(threshold)}
          y2={y(threshold)}
          className="threshold-line"
        />
        <polyline points={line(points, "vwc")} className="forecast-line" />
        {scheduled && (
          <polyline
            points={line(scheduled, "vwc")}
            className="scheduled-line"
          />
        )}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={x(h)} y="190" textAnchor="middle">
            {h}h
          </text>
        ))}
      </svg>
      <figcaption>
        {t("أخضر: دون ري · كهرماني متقطع: حد التدخل · تظليل: حساسية مفترضة")}
        {scheduled && <> · {t("أزرق: مع المقترح الافتراضي")}</>}
      </figcaption>
    </figure>
  );
}
export function ForecastCrossing({
  result,
}: {
  result: Pick<Plan, "forecast" | "crossing_hour">;
}) {
  return (
    <p>
      {t("بلوغ حد التدخل في السيناريو")}:{" "}
      {result.forecast.length === 0
        ? t("غير متاح")
        : result.crossing_hour === null
          ? t("غير متوقع ضمن 24 ساعة")
          : `${number(result.crossing_hour)} ${t("ساعة من الآن")}`}
    </p>
  );
}
export function ResearchTable({ research }: { research: Research }) {
  return (
    <>
      <p>
        {t(
          "بحث فقط؛ لا يُستخدم لإصدار قرارات ري. MAE وRMSE بالنقاط المئوية للرطوبة حسب وحدة المصدر.",
        )}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "المعاملة",
                "الأفق (ساعة)",
                "النموذج",
                "العينات",
                "MAE",
                "RMSE",
                "هامش 90% بحثي",
                "التغطية الفعلية للفترة",
              ].map((h) => (
                <th key={h}>{t(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {research.evaluation.map((r) => (
              <tr key={`${r.treatment}-${r.horizon_h}-${r.model}`}>
                <td>
                  {t(r.treatment === "Irrigated" ? "مروية" : "غير مروية")}
                </td>
                <td>{r.horizon_h}</td>
                <td>{r.model}</td>
                <td>{r.n}</td>
                <td>{r.mae_pp.toFixed(4)}</td>
                <td>{r.rmse_pp.toFixed(4)}</td>
                <td>±{r.interval_half_width_pp.toFixed(4)}</td>
                <td>{number(r.test_interval_coverage * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        {t(
          "تدريب زمني 2021 ومعايرة منفصلة، اختبار 2022؛ لا طقس مستقبلي ضمن المدخلات. بقيت نتيجة OLS السابقة محفوظة. التعميم على الرياض غير متحقق.",
        )}
      </p>
    </>
  );
}
export default function PredictivePlanner({
  zone,
  report,
  onDecisions,
}: {
  zone: Zone;
  report: Report;
  onDecisions: () => void;
}) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => savedProfile(zone.id),
    () => "",
  );
  let stored: Partial<Profile> = {};
  try {
    stored = JSON.parse(snapshot || "{}");
  } catch {
    /* Corrupt browser settings are not operational data. */
  }
  const [result, setResult] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [spatial, setSpatial] = useState<Spatial | null>(null),
    [research, setResearch] = useState<Research | null>(null);
  const formRef = useRef<HTMLFormElement>(null),
    token = useRef(0);
  function invalidate() {
    token.current++;
    setResult(null);
    setError("");
    setBusy(false);
  }
  function demo() {
    const form = formRef.current;
    if (!form) return;
    const values: Record<string, string> = {
      plant: zone.plant.name,
      soil: "FAO-56 loamy sand — demo",
      evidence: "FAO-56 Example 36; local calibration absent",
      provenance: "demo_assumption",
      fc: "15",
      wp: "6",
      threshold: "10.5",
      target: "14",
      depth: "0.2",
      area: String(zone.irrigated_area_m2 ?? zone.area_m2),
      efficiency: "80",
      flow: "",
      baseline: "hypothetical",
      start: "12",
      et: "5",
      rain: "0",
      rain_hour: "18",
      uncertainty: "0.5",
      allowed_start: "0",
      allowed_end: "24",
      cooldown: "12",
      hysteresis: "1",
      mode: "automatic_simulation",
      previous: "",
    };
    for (const [name, value] of Object.entries(values)) {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)
        el.value = value;
    }
    invalidate();
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      id = ++token.current;
    const n = (name: string) => Number(f.get(name));
    const profile: Profile = {
      plant: String(f.get("plant")),
      soil: String(f.get("soil")),
      provenance: f.get("provenance") as Profile["provenance"],
      evidence: String(f.get("evidence")),
      field_capacity: n("fc") / 100,
      wilting_point: n("wp") / 100,
      threshold: n("threshold") / 100,
      target: n("target") / 100,
      root_depth_m: n("depth"),
      area_m2: n("area"),
      efficiency: n("efficiency") / 100,
      flow_l_h: f.get("flow") ? n("flow") : null,
    };
    if (
      f.get("baseline") === "hypothetical" &&
      !String(f.get("start") ?? "").trim()
    ) {
      setError(t("أدخل رطوبة بداية افتراضية"));
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const value = await api<Plan>(
        `/zones/${zone.id}/plan`,
        post({
          profile,
          baseline_mode: f.get("baseline"),
          ...(f.get("baseline") === "hypothetical"
            ? { starting_vwc: n("start") / 100 }
            : {}),
          weather:
            f.get("et") === ""
              ? null
              : {
                  kind: "assumed",
                  et_mm_day: n("et"),
                  rain_mm: n("rain"),
                  rain_hour: n("rain_hour"),
                  uncertainty_vwc: n("uncertainty") / 100,
                },
          mode: f.get("mode"),
          allowed_start_hour: n("allowed_start"),
          allowed_end_hour: n("allowed_end"),
          cooldown_hours: n("cooldown"),
          hysteresis_vwc: n("hysteresis") / 100,
          last_simulated_hour: f.get("previous") ? -n("previous") : null,
        }),
      );
      if (id !== token.current) return;
      setResult(value);
      try {
        localStorage.setItem(profileKey(zone.id), JSON.stringify(profile));
        window.dispatchEvent(new Event("anbit-profile"));
      } catch {
        setError(t("حُسب السيناريو؛ تعذر حفظ الإعدادات في هذا المتصفح"));
      }
    } catch (err) {
      if (id === token.current)
        setError(err instanceof Error ? err.message : t("تعذر الحساب"));
    } finally {
      if (id === token.current) setBusy(false);
    }
  }
  const displayedVolume = result
    ? (result.schedule[0]?.volume_l ?? result.estimate.gross_l)
    : zone.decision.code === "review"
      ? zone.decision.estimate?.gross_l
      : null;
  const pct = (v: number | null | undefined) => (v == null ? "" : v * 100);
  const input = (
    name: string,
    label: string,
    value: string | number,
    min = 0,
    max = 100,
    required = true,
  ) => (
    <label>
      {t(label)}
      <input
        name={name}
        type="number"
        step="any"
        defaultValue={value}
        min={min}
        max={max}
        required={required}
      />
    </label>
  );
  return (
    <section
      className="panel predictive-panel"
      aria-label={t("التخطيط التنبؤي")}
    >
      <div className="planning-title">
        <div>
          <span className="eyebrow">{t("التخطيط التنبؤي")}</span>
          <h2>{t("من حالة التربة إلى موعد الري")}</h2>
        </div>
        <span className="status">
          {t(result ? "محاكاة افتراضية" : "التوقع التشغيلي غير متاح")}
        </span>
      </div>
      <div className="planning-cards">
        <div>
          <small>{t("رطوبة التربة الحالية")}</small>
          <strong>
            {zone.decision.mean_vwc === null
              ? t("غير متاح")
              : `${number(zone.decision.mean_vwc * 100)}%`}
          </strong>
          <small>
            {t("متوسط نقاط صالحة؛ قد لا يمثل كامل المنطقة")} ·{" "}
            {t(
              zone.origin === "simulation"
                ? "بيانات محاكاة محفوظة"
                : "إدخالات محفوظة",
            )}
          </small>
        </div>
        <div>
          <small>{t("موعد الري القادم")}</small>
          <strong>
            {result?.schedule[0] ? date(result.schedule[0].at) : t("غير متاح")}
          </strong>
          <small>{t("لا طقس حي ولا ML معتمد محليًا")}</small>
        </div>
        <div>
          <small>{t("الاحتياج المائي")}</small>
          <strong>
            {displayedVolume != null
              ? `${number(displayedVolume)} ${t("لتر")}`
              : t("غير متاح")}
          </strong>
          <small>
            {t(
              result?.schedule.length
                ? "كمية المقترح عند موعده — افتراضية"
                : result
                  ? "حساب مشروط للوصول إلى هدف السيناريو"
                  : "تقدير المحرك الحالي وفق افتراضات المنطقة",
            )}
          </small>
        </div>
        <div>
          <small>{t("مدة الري")}</small>
          <strong>
            {(result?.schedule[0]?.duration_hours ?? result?.duration_hours) !=
            null
              ? `${number((result?.schedule[0]?.duration_hours ?? result?.duration_hours)!)} ${t("ساعة")}`
              : t("التدفق غير معروف")}
          </strong>
          <small>{t("مدة تطبيق نظرية؛ ليست ضمانًا للرطوبة")}</small>
        </div>
        <div>
          <small>{t("استهلاك مسجل بالمحاكاة")}</small>
          <strong>
            {number(report.total_l)} {t("لتر")}
          </strong>
          <small>{t("التوفير الفعلي غير متاح؛ لا خط أساس متحقق")}</small>
        </div>
      </div>
      {!result && (
        <p>
          {t(
            "أكمل القياسات والمعايرة والطقس الموثق للتخطيط الفعلي، أو افتح سيناريو عرض معلنًا أدناه.",
          )}
        </p>
      )}
      <details className="planning-config">
        <summary>{t("إعداد ملف النبات والتربة وسيناريو 24 ساعة")}</summary>
        <p>
          {t(
            "إعدادات لكل منطقة محفوظة في هذا المتصفح فقط؛ لا تغيّر ملف التربة أو قرارات الري المحفوظة. الإعدادات المدخلة لم يتحقق منها النظام ميدانيًا.",
          )}
        </p>
        <button type="button" onClick={demo}>
          {t("تعبئة افتراضات عرض واضحة")}
        </button>
        <form ref={formRef} onSubmit={submit} onChange={invalidate}>
          <fieldset>
            <legend>{t("ملف النبات والتربة")}</legend>
            <div className="planning-inputs">
              <label>
                {t("نوع النبات")}
                <input
                  name="plant"
                  defaultValue={stored.plant ?? zone.plant.name}
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
              <label>
                {t("نوع التربة")}
                <input
                  name="soil"
                  defaultValue={stored.soil ?? zone.soil?.name}
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
              <label>
                {t("مصدر الإعدادات")}
                <select
                  name="provenance"
                  defaultValue={stored.provenance ?? "demo_assumption"}
                >
                  <option value="demo_assumption">{t("افتراضات عرض")}</option>
                  <option value="user_supplied">
                    {t("إدخال مستخدم غير متحقق آليًا")}
                  </option>
                </select>
              </label>
              <label>
                {t("مرجع التربة والمعايرة")}
                <input
                  name="evidence"
                  defaultValue={stored.evidence ?? ""}
                  minLength={8}
                  maxLength={500}
                  required
                />
              </label>
              {input(
                "fc",
                "السعة الحقلية (% حجمية)",
                pct(stored.field_capacity),
              )}
              {input("wp", "نقطة الذبول (% حجمية)", pct(stored.wilting_point))}
              {input("threshold", "حد التدخل (% حجمية)", pct(stored.threshold))}
              {input("target", "الهدف (% حجمية)", pct(stored.target))}
              {input(
                "depth",
                "عمق الجذور (م)",
                stored.root_depth_m ?? zone.root_depth_m ?? "",
                0.001,
                3,
              )}
              {input(
                "area",
                "مساحة الري (م²)",
                stored.area_m2 ?? zone.irrigated_area_m2 ?? "",
                0.001,
                zone.area_m2,
              )}
              {input(
                "efficiency",
                "الكفاءة (%)",
                pct(stored.efficiency ?? zone.efficiency),
                0.01,
                100,
              )}
              {input(
                "flow",
                "التدفق (لتر/ساعة) — اختياري",
                stored.flow_l_h ?? "",
                0.01,
                1000000,
                false,
              )}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t("خط البداية والطقس المفترض")}</legend>
            <div className="planning-inputs">
              <label>
                {t("مصدر البداية")}
                <select name="baseline">
                  <option value="stored">
                    {t("القراءات المحفوظة — مع بوابات السلامة")}
                  </option>
                  <option value="hypothetical">{t("بداية افتراضية")}</option>
                </select>
              </label>
              {input("start", "رطوبة بداية افتراضية (%)", "", 0, 100, false)}
              {input(
                "et",
                "فقد تبخر ونتح مفترض (مم/يوم) — اتركه فارغًا لعدم توفر الطقس",
                "",
                0,
                30,
                false,
              )}
              {input("rain", "مطر مفترض (مم)", 0, 0, 200)}
              {input("rain_hour", "المطر بعد كم ساعة؟", 18, 1, 24)}
              {input(
                "uncertainty",
                "هامش حساسية مفترض (نقطة مئوية)",
                1,
                0.5,
                30,
              )}
            </div>
            <p>
              {t(
                "لا اتصال بطقس حي. قيمة الفقد تمثل افتراض الطلب المائي للنبات، دون مضاعف حرارة مخفي. لا تُستخدم معدلات المدن كتوقع ساعي.",
              )}
            </p>
          </fieldset>
          <fieldset>
            <legend>{t("نمط الري")}</legend>
            <div className="planning-inputs">
              <label>
                {t("النمط")}
                <select name="mode">
                  <option value="manual">{t("يدوي")}</option>
                  <option value="automatic_simulation">
                    {t("تلقائي (محاكاة)")}
                  </option>
                </select>
              </label>
              {input(
                "allowed_start",
                "بداية ساعات الري — توقيت الرياض",
                4,
                0,
                23,
              )}
              {input(
                "allowed_end",
                "نهاية ساعات الري — توقيت الرياض",
                9,
                1,
                24,
              )}
              {input("cooldown", "فترة انتظار بين المقترحات (ساعة)", 12, 1, 72)}
              {input(
                "previous",
                "ساعات منذ ري افتراضي سابق — اختياري",
                "",
                0,
                72,
                false,
              )}
              {input("hysteresis", "هامش الاستقرار (نقطة مئوية)", 1, 0.1, 10)}
            </div>
          </fieldset>
          <button className="primary" disabled={busy}>
            {t(busy ? "جارٍ الحساب…" : "احسب خطة افتراضية")}
          </button>
        </form>
      </details>
      {error && <p role="alert">{t(error)}</p>}
      {result && (
        <div className="planning-result" role="status">
          <h3>{t("السيناريو — لا تشغيل ولا حفظ للري")}</h3>
          <p>
            {t(
              result.mode === "automatic_simulation"
                ? "تلقائي (محاكاة)"
                : "يدوي",
            )}{" "}
            · {t("بداية السيناريو")}: {number(result.baseline_vwc * 100)}% ·{" "}
            {t(
              result.baseline_origin === "user_hypothesis"
                ? "بداية افتراضية"
                : "إدخالات محفوظة",
            )}
          </p>
          <p>
            {t("النطاق المناسب للنبات")}:{" "}
            {number(result.profile.threshold * 100)}–
            {number(result.profile.target * 100)}% ·{" "}
            {t("وفق افتراضات الملف فقط")}
          </p>
          {result.forecast.length > 0 && (
            <ForecastChart
              points={result.forecast}
              scheduled={result.scheduled_forecast}
              threshold={result.profile.threshold}
              event={result.schedule[0]}
            />
          )}
          <ForecastCrossing result={result} />
          {result.blocked.map((msg) => (
            <p key={msg} className="planning-warning">
              {t(msg)}
            </p>
          ))}
          {result.schedule.map((s) => (
            <div key={s.hour} className="planning-proposal">
              <strong>{date(s.at)}</strong> · {number(s.volume_l)} {t("لتر")} ·{" "}
              {s.duration_hours === null
                ? t("المدة غير معروفة")
                : `${number(s.duration_hours)} ${t("ساعة")}`}
              <p>
                {t("الرطوبة بعد الري نظريًا")}: {number(s.post_low * 100)}–
                {number(s.post_high * 100)}%
              </p>
            </div>
          ))}
          <p>
            {t("الري التالي بعد المقترح")}:{" "}
            {result.forecast.length === 0
              ? t("غير متاح")
              : result.next_window_hour === null
                ? t("غير محدد ضمن أفق السيناريو")
                : `${number(result.next_window_hour)} ${t("ساعة من الآن")}`}
          </p>
          <button onClick={onDecisions}>
            {t("المراجعة والموافقة عبر قرارات الري")}
          </button>
          <details>
            <summary>{t("الافتراضات والحدود")}</summary>
            {result.limitations.map((msg) => (
              <p key={msg}>{t(msg)}</p>
            ))}
            <p>
              {t(
                "1 لتر/م² = 1 مم. الهدف لا يتجاوز السعة الحقلية. الماء فوق السعة في السيناريو فائض غير محتفظ به؛ توزيعه بين الصرف والجريان غير معلوم.",
              )}
            </p>
          </details>
        </div>
      )}
      <details>
        <summary>{t("تقدير مكاني تجريبي ومناطق تحتاج قياسًا")}</summary>
        <button
          disabled={busy}
          onClick={async () => {
            try {
              setSpatial(await api<Spatial>(`/zones/${zone.id}/spatial`));
            } catch (e) {
              setError(e instanceof Error ? e.message : t("تعذر الحساب"));
            }
          }}
        >
          {t("تحديث التقدير المكاني")}
        </button>
        {spatial && (
          <>
            <p>
              {t(
                "استيفاء IDW تجريبي؛ ليس نموذج ML مدربًا. الخلايا لا تصبح قراءات.",
              )}
            </p>
            <p>
              {t("تغطية القياسات الهندسية")}:{" "}
              {number(spatial.measured_coverage * 100)}% ·{" "}
              {t("مساحة دعم الاستيفاء")}:{" "}
              {number(spatial.estimated_support_fraction * 100)}%
            </p>
            <svg
              className="spatial-chart"
              viewBox={`${zone.x} ${zone.y} ${zone.width} ${zone.height}`}
              role="img"
              aria-label={t(
                "مربعات تقديرية ودوائر قياسات محفوظة ومعين للقياس التالي",
              )}
            >
              {spatial.cells.map((c, i) => (
                <rect
                  key={i}
                  x={c.x - zone.width / 16}
                  y={c.y - zone.height / 16}
                  width={zone.width / 8}
                  height={zone.height / 8}
                  fill={
                    c.vwc === null
                      ? "var(--planning-gap)"
                      : `hsl(145 35% ${85 - c.vwc * 65}%)`
                  }
                  stroke="var(--planning-line)"
                  strokeWidth=".1"
                >
                  <title>
                    {c.vwc === null
                      ? t("لا دعم كافٍ؛ يلزم قياس")
                      : `${number(c.vwc * 100)}% · ${t("انتشار محلي")}: ${number((c.local_spread ?? 0) * 100)} ${t("نقطة مئوية")}`}
                  </title>
                </rect>
              ))}
              {spatial.measured.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={zone.width / 65}
                  fill="var(--planning-ink)"
                  stroke="white"
                  strokeWidth=".2"
                >
                  <title>
                    {number(p.vwc * 100)}% · {t("قراءة محفوظة")}
                  </title>
                </circle>
              ))}
              <path
                d={`M${spatial.next_point.x},${spatial.next_point.y - zone.width / 40} l${zone.width / 40},${zone.width / 40} l${-zone.width / 40},${zone.width / 40} l${-zone.width / 40},${-zone.width / 40} Z`}
                fill="#bd7626"
              />
            </svg>
            <p>
              {t(
                "دوائر: قراءات · مربعات خضراء: تقدير · رمادي: قياس مطلوب · معين: الموقع التالي",
              )}
            </p>
            <p>
              {t(
                "نقيس تباعد النقاط وانتشارها فقط؛ لا توجد نسبة ثقة إحصائية. يلزم ثلاث نقاط قريبة على الأقل ولا استيفاء عند التعارض.",
              )}
            </p>
            <p>
              {t("القياس التالي")}: ({number(spatial.next_point.x)},{" "}
              {number(spatial.next_point.y)}) {t("متر محلي")} ·{" "}
              {t(spatial.next_point.reason)}
            </p>
          </>
        )}
      </details>
      <details>
        <summary>{t("نتائج بحث التنبؤ — Melbourne Turfgrass")}</summary>
        <button
          onClick={async () => {
            try {
              setResearch(await api<Research>("/research/forecast"));
            } catch (e) {
              setError(e instanceof Error ? e.message : t("تعذر الحساب"));
            }
          }}
        >
          {t("عرض مقارنة النماذج")}
        </button>
        {research && <ResearchTable research={research} />}
      </details>
    </section>
  );
}
