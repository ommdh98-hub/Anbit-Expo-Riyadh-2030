"use client";
import { useEffect, useState, type MouseEvent } from "react";
import { api, number } from "../lib/api";
import { display as t, currentLanguage } from "../lib/i18n";
import {
  downloadCsv,
  hypotheticalSavings,
  type Research,
} from "../lib/planning";
import { ResearchTable } from "./predictive-planner";
import BrandLogo from "./brand-logo";
import plantCity from "../data/plant-city.json";
import { formatReportVolume } from "../lib/report-format.mjs";
import { printExecutiveReport } from "../lib/report-print.mjs";
type Executive = {
  generated_at: string;
  plant_catalog_count?: number;
  start: string;
  end: string;
  days: number;
  groups: {
    origin: string;
    total_l: number;
    total_m3: number;
    events_count: number;
    measured_l: number;
    estimated_l: number;
  }[];
  events: {
    id: string;
    zone_id: string;
    origin: string;
    volume_l: number;
    volume_kind: string;
    executed_at: string;
  }[];
  zones: {
    id: string;
    name: string;
    origin: string;
    mean_vwc: number | null;
    valid_readings: number;
    coverage_fraction: number;
    decision: string;
    missing: string[];
  }[];
  daily: { date: string; origin: string; litres: number }[];
  proposals: {
    id: string;
    zone_id: string;
    origin: string;
    gross_l: number;
    status: string;
  }[];
  decisions: {
    id: string;
    zone_id: string;
    status: string;
    created_at: string;
    outcome: string;
  }[];
  forecast_quality: Research;
  limitations: string[];
  sources: {
    id: string;
    title: string;
    description: string;
    url: string | null;
  }[];
};
const originName: Record<string, string> = {
  field: "سجلات ميدانية",
  manual: "سجلات يدوية",
  estimated: "سجلات تقديرية",
  simulation: "سجلات محاكاة",
};
export function ExecutiveBody({ data }: { data: Executive }) {
  function printReport(
    e: MouseEvent<HTMLButtonElement>,
    scope: "executive" | "technical" = "executive",
  ) {
    const root = e.currentTarget.closest<HTMLElement>("article");
    if (!root) return;
    printExecutiveReport(root, scope);
  }
  const reportDate = (v: string) =>
    new Date(v).toLocaleString(currentLanguage() === "ar" ? "ar-SA" : "en-GB", {
      timeZone: "Asia/Riyadh",
      calendar: "gregory",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const [baseline, setBaseline] = useState("");
  const [comparisonOrigin, setComparisonOrigin] = useState("simulation");
  const current =
    data.groups.find((g) => g.origin === comparisonOrigin)?.total_l ?? 0;
  const savings = hypotheticalSavings(
    current,
    baseline.trim() ? Number(baseline) : null,
  );
  function csv() {
    const rows: (string | number)[][] = [
      [
        t("نوع السجل"),
        t("المصدر"),
        t("المنطقة"),
        t("الوقت"),
        t("لتر"),
        t("نوع الكمية"),
        t("الحالة"),
      ],
    ];
    const name = (id: string) =>
      t(data.zones.find((z) => z.id === id)?.name ?? id);
    for (const e of data.events)
      rows.push([
        t("تنفيذ مسجل"),
        t(originName[e.origin] ?? e.origin),
        name(e.zone_id),
        e.executed_at,
        e.volume_l,
        t(e.volume_kind === "measured" ? "مقاسة" : "مقدرة"),
        t("منفذ"),
      ]);
    for (const p of data.proposals)
      rows.push([
        t("مقترح لم ينفذ"),
        t(originName[p.origin] ?? p.origin),
        name(p.zone_id),
        "",
        p.gross_l,
        "",
        t(p.status === "approved" ? "معتمد" : "مقترح"),
      ]);
    rows.push([
      t("سيناريوهات غير محفوظة"),
      "",
      "",
      "",
      "",
      "",
      t("لا تدخل الاستهلاك"),
    ]);
    downloadCsv(rows);
  }
  return (
    <article className="executive-report" aria-label={t("تقرير الإدارة")}>
      <div className="planning-title">
        <div className="report-brand">
          <BrandLogo variant="report" eager />
          <div>
            <span className="eyebrow">ANBIT · {t("تقرير الإدارة")}</span>
            <h2>{t("تقرير إدارة المياه التنفيذي")}</h2>
          </div>
        </div>
        <div className="report-actions">
          <button className="primary" onClick={(e) => printReport(e)}>
            {t("طباعة التقرير")}
          </button>
          <button onClick={csv}>{t("تصدير CSV")}</button>
        </div>
      </div>
      <p className="report-print-help">
        {t(
          "لملف PDF موجز اختر طباعة التقرير. جدول البحث له ملحق منفصل. عطّل رؤوس وتذييلات المتصفح في نافذة الطباعة لإخفاء العنوان والرابط المحلي.",
        )}
      </p>
      <section className="report-page report-page-one">
        <p className="report-period">
          {t("الفترة")}: {reportDate(data.start)} — {reportDate(data.end)} ·{" "}
          {t("أُنشئ في")}: {reportDate(data.generated_at)} ·{" "}
          {t("بتوقيت الرياض")}
        </p>
        <h3>{t("ملخص الإدارة")}</h3>
        <p>
          {t("نطاق التقرير: جميع مناطق الموقع المعروضة أدناه")} (
          {data.zones.length})
        </p>
        <p>
          {t(
            "يفصل التقرير الاستخدام المسجل بحسب المصدر، والمقترحات غير المنفذة، والسيناريوهات غير المحفوظة. لا يوجد خط أساس يثبت توفيرًا فعليًا ولا توقع ML معتمد محليًا.",
          )}
        </p>
        <p className="report-catalog-counts">
          {t("المستكشف")}: {plantCity.plants.length} {t("نباتًا")} ·{" "}
          {plantCity.cities.length} {t("مدينة")} ·{" "}
          {t("ملفات نباتات الموقع الأصلية")}:{" "}
          {data.plant_catalog_count ?? t("غير متاح")}.
        </p>
        <p className="report-simulation-label">
          {t(
            "كميات سجلات المحاكاة ليست قياسات عدادات تدفق ميدانية، حتى إن اختير لها نوع كمية «مقاسة» عند الإدخال.",
          )}
        </p>
        <div className="planning-cards">
          {data.groups.map((g) => (
            <div key={g.origin}>
              <small>{t(originName[g.origin])}</small>
              <strong>
                {formatReportVolume(g.total_l, currentLanguage()).litres}{" "}
                {t("لتر")}
              </strong>
              <small>
                {formatReportVolume(g.total_l, currentLanguage()).cubicMetres}{" "}
                {t("م³")} · {number(g.events_count)} {t("عملية")}
              </small>
              <small>
                {t("مقاسة")}: {number(g.measured_l)} · {t("مقدرة")}:{" "}
                {number(g.estimated_l)}
              </small>
            </div>
          ))}
        </div>
        <p>
          {t(
            "المقترحات لا تدخل الاستهلاك. السيناريوهات تعرض لحظيًا ولا تجمع في التقرير؛ الصفر المسجل لا يثبت انعدام الري خارج النظام.",
          )}
        </p>
        <div className="report-snapshot">
          <h3>{t("حالة التربة والتغطية — لقطة حالية")}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "المنطقة",
                    "المصدر",
                    "متوسط الرطوبة",
                    "قراءات صالحة",
                    "تغطية هندسية",
                    "القرار",
                    "ما يلزم استكماله",
                  ].map((h) => (
                    <th key={h}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.zones.map((z) => (
                  <tr key={z.id}>
                    <td>{t(z.name)}</td>
                    <td>{t(originName[z.origin] ?? z.origin)}</td>
                    <td>
                      {z.mean_vwc === null
                        ? t("غير متاح")
                        : `${number(z.mean_vwc * 100)}%`}
                    </td>
                    <td>{z.valid_readings}</td>
                    <td>{number(z.coverage_fraction * 100)}%</td>
                    <td>{t(z.decision)}</td>
                    <td>
                      {z.missing.length
                        ? z.missing.map(t).join(" · ")
                        : t("مراجعة الافتراضات الميدانية")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {t(
              "المتوسط من النقاط المقبولة فقط؛ قد لا يمثل المنطقة. لا تضاف رطوبة الاستيفاء أو السيناريو إلى القياسات. التغطية ليست نسبة ثقة.",
            )}
          </p>
        </div>
      </section>
      <section className="report-page report-page-two">
        <details className="report-screen-only report-daily">
          <summary>{t("الاستخدام عبر الزمن بحسب المصدر")}</summary>
          {data.daily.length ? (
            <div className="report-trends">
              {data.daily.map((d) => (
                <div key={d.date + d.origin}>
                  <span>
                    {d.date} · {t(originName[d.origin] ?? d.origin)}
                  </span>
                  <meter
                    min="0"
                    max={Math.max(...data.daily.map((r) => r.litres), 1)}
                    value={d.litres}
                  />
                  <strong>
                    {number(d.litres)} {t("لتر")}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <p>{t("لا توجد عمليات مسجلة ضمن الفترة")}</p>
          )}
        </details>
        <h3>{t("الأحداث المسجلة")}</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {["المنطقة", "المصدر", "الوقت", "لتر", "نوع الكمية"].map(
                  (h) => (
                    <th key={h}>{t(h)}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td>
                    {t(
                      data.zones.find((z) => z.id === e.zone_id)?.name ??
                        e.zone_id,
                    )}
                  </td>
                  <td>{t(originName[e.origin] ?? e.origin)}</td>
                  <td>{reportDate(e.executed_at)}</td>
                  <td>{number(e.volume_l)}</td>
                  <td>{t(e.volume_kind === "measured" ? "مقاسة" : "مقدرة")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>{t("مقترحات لم تنفذ")}</h3>
        {data.proposals.length ? (
          data.proposals.map((p) => (
            <p key={p.id}>
              {t(data.zones.find((z) => z.id === p.zone_id)?.name ?? p.zone_id)}{" "}
              · {t(originName[p.origin] ?? p.origin)} · {number(p.gross_l)}{" "}
              {t("لتر")} · {t(p.status === "approved" ? "معتمد" : "مقترح")}
            </p>
          ))
        ) : (
          <p>{t("لا توجد مقترحات حالية مؤهلة في الفترة")}</p>
        )}
        <h3>{t("القرارات ونتائجها المسجلة")}</h3>
        {data.decisions.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {["المنطقة", "الوقت", "الحالة", "النتيجة"].map((h) => (
                    <th key={h}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.decisions.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {t(
                        data.zones.find((z) => z.id === r.zone_id)?.name ??
                          r.zone_id,
                      )}
                    </td>
                    <td>{reportDate(r.created_at)}</td>
                    <td>
                      {t(
                        (
                          {
                            suggested: "مقترح",
                            approved: "معتمد",
                            deferred: "مؤجل",
                            executed: "منفذ",
                          } as Record<string, string>
                        )[r.status] ?? r.status,
                      )}
                    </td>
                    <td>
                      {t(
                        r.outcome === "recorded_execution"
                          ? "تنفيذ مسجل ضمن الفترة"
                          : "لا تنفيذ مرتبط ضمن الفترة",
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{t("لا توجد قرارات مسجلة ضمن الفترة")}</p>
        )}
        <details className="report-screen-only hypothetical-comparison">
          <summary>{t("مقارنة افتراضية")}</summary>
          <h3>
            {t("التوفير الفعلي")}: {t("غير متاح")}
          </h3>
          <h4>{t("مقارنة افتراضية")}</h4>
          <p>
            {t(
              "مثال مقارنة فقط، للفترة والمناطق نفسها. النتيجة السالبة تعني استخدامًا أعلى من الفرضية، وليست توفيرًا مثبتًا.",
            )}
          </p>
          <div className="planning-inputs">
            <label>
              {t("مصدر الاستهلاك للمقارنة")}
              <select
                value={comparisonOrigin}
                onChange={(e) => setComparisonOrigin(e.target.value)}
              >
                {data.groups.map((g) => (
                  <option key={g.origin} value={g.origin}>
                    {t(originName[g.origin])}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("خط أساس افتراضي للفترة (لتر)")}
              <input
                type="number"
                min="0"
                step="any"
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
              />
            </label>
          </div>
          <p>
            {t("نتيجة المقارنة الافتراضية")}:{" "}
            {savings === null ? t("غير متاح") : `${number(savings)}%`} ·{" "}
            {t("الاستهلاك المختار")}: {number(current)} {t("لتر")}
          </p>
        </details>
        <h3>{t("المخاطر والتوصيات العملية")}</h3>
        <ul>
          {data.limitations.map((msg) => (
            <li key={msg}>{t(msg)}</li>
          ))}
        </ul>
        <p>
          {t(
            "الأولوية: قياس الفجوات، توثيق معايرة التربة وعمق الجذور، التحقق من التدفق، ثم تقييم التوقعات ميدانيًا قبل الأتمتة.",
          )}
        </p>
        <details className="report-sources" data-print-expand="main">
          <summary>{t("المصادر")}</summary>
          {data.sources.map((s) => (
            <p key={s.id}>
              <strong>{t(s.title)}</strong> · {t(s.description)}{" "}
              {s.url &&
                /^https:\/\//.test(s.url) &&
                !/localhost|127\.0\.0\.1/.test(s.url) && (
                  <a href={s.url}>{t("المرجع")}</a>
                )}
            </p>
          ))}
          <p>
            <a href="https://www.fao.org/4/X0490E/x0490e0e.htm">
              FAO-56 · {t("موازنة منطقة الجذور")}
            </a>{" "}
            ·{" "}
            <a href="https://zenodo.org/records/10972539">
              Melbourne Turfgrass · Zenodo 10972539
            </a>
          </p>
        </details>
      </section>
      <details className="report-research report-technical-appendix">
        <summary>{t("الملحق التقني الاختياري — جودة توقعات البحث")}</summary>
        <h3>{t("ملحق بحثي مستقل عن تقرير الإدارة")}</h3>
        <button onClick={(e) => printReport(e, "technical")}>
          {t("طباعة الملحق التقني فقط")}
        </button>
        <ResearchTable research={data.forecast_quality} />
      </details>
    </article>
  );
}
export default function ExecutiveReport({ days }: { days: number }) {
  const [data, setData] = useState<Executive | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    api<Executive>(`/reports/executive?days=${days}`)
      .then((r) => {
        if (active) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : t("تعذر تحميل التقرير"));
      });
    return () => {
      active = false;
    };
  }, [days, retry]);
  if (error)
    return (
      <div role="alert">
        {t(error)}{" "}
        <button onClick={() => setRetry((r) => r + 1)}>
          {t("إعادة المحاولة")}
        </button>
      </div>
    );
  return data ? (
    <ExecutiveBody data={data} />
  ) : (
    <p role="status">{t("جارٍ تحميل التقرير")}</p>
  );
}
