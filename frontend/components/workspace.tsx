"use client";
import PreferencesControls from "./preferences-controls";
import { display } from "../lib/i18n";
import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import BrandLogo from "./brand-logo";
import {
  LayoutDashboard,
  Map,
  Leaf,
  BarChart3,
  BookOpen,
  Plus,
  ArrowUpLeft,
  RefreshCw,
  Droplets,
  ScanLine,
  ChevronLeft,
  Check,
  X,
  Info,
  ClipboardCheck,
  AlertTriangle,
  Menu,
} from "lucide-react";
import SiteMap from "./site-map";
import DigitalTwin from "./digital-twin";
import PlantCityExplorer from "./plant-city-explorer";
import GuidedEvaluation, { simpleState } from "./guided-evaluation";
import LandscapeHome from "./landscape-home";
import ExecutiveReport from "./executive-report";
import SurveyHome from "./survey-home";
import IndividualHome from "./individual-home";
import { BeginnerSoilGuide } from "./growing-guide";
import PlantGuide from "./plant-guide";
import { navigationFor, suggestedMeasurement } from "../lib/role-home";
import type { AnbitProfile } from "./auth-gate";
import { LogOut } from "lucide-react";
import { WaterChart, MoistureChart } from "./charts";
import { api, post, number, date } from "../lib/api";
import {
  Zone,
  Report,
  Recommendation,
  Plant,
  Inspection,
  Decision,
} from "../lib/types";

type View =
  | "overview"
  | "map"
  | "zone"
  | "decisions"
  | "water"
  | "plants"
  | "measurements";
type Modal = "reading" | "inspection" | "execute" | null;
const navigationIcons = {
  overview: LayoutDashboard,
  map: Map,
  decisions: Leaf,
  water: BarChart3,
  plants: BookOpen,
  measurements: ClipboardCheck,
};
const stateLabels: Record<string, string> = {
  suggested: "مقترح",
  approved: "معتمد",
  deferred: "مؤجل",
  executed: "منفّذ",
};
function Status({ decision }: { decision: Decision }) {
  return (
    <span className={`status ${decision.code}`}>
      <i />
      {display(decision.label)}
    </span>
  );
}

export default function Workspace({
  profile,
  onLogout,
}: {
  profile: AnbitProfile;
  onLogout: () => void;
}) {
  const canMeasure = profile.role === "survey";
  const canOperate = profile.role === "survey";
  const nav = navigationFor(profile.role).map((item) => ({
    ...item,
    icon: navigationIcons[item.id],
  }));
  const [view, setView] = useState<View>("overview"),
    [zones, setZones] = useState<Zone[]>([]),
    [selected, setSelected] = useState("z1");
  const [report, setReport] = useState<Report | null>(null),
    [recs, setRecs] = useState<Recommendation[]>([]),
    [plants, setPlants] = useState<Plant[]>([]),
    [inspections, setInspections] = useState<Inspection[]>([]);
  const [guideStep, setGuideStep] = useState<1 | 2 | 3>(1);
  const [guideChosen, setGuideChosen] = useState(false);
  const [measurementMapZone, setMeasurementMapZone] = useState<string | null>(
    null,
  );
  const [readingFeedback, setReadingFeedback] = useState("");
  const [dataVersion, setDataVersion] = useState(0);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState<Modal>(null),
    [executeId, setExecuteId] = useState(""),
    [days, setDays] = useState(7),
    [mobileNav, setMobileNav] = useState(false),
    [estimate, setEstimate] = useState<Decision | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    const [z, r, c, p] = await Promise.all([
      api<Zone[]>("/zones"),
      api<Report>(`/reports/water?days=${days}`),
      api<Recommendation[]>("/recommendations"),
      api<Plant[]>("/plants"),
    ]);
    setZones(z);
    setDataVersion((v) => v + 1);
    setReport(r);
    setRecs(c);
    setPlants(p);
    setLoading(false);
  }, [days]);
  // load awaits network responses before updating state; no synchronous effect update.
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load awaits API responses before setting state.
    load().catch((e) => {
      if (live) {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [load]);
  useEffect(() => {
    if (modal) {
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [modal]);
  useEffect(() => {
    if (view === "zone")
      api<Inspection[]>(`/zones/${selected}/inspections`)
        .then(setInspections)
        .catch((e) => setError(e.message));
  }, [view, selected, notice]);
  const zone = zones.find((z) => z.id === selected) || zones[0];
  const go = (next: View) => {
    window.scrollTo(0, 0);
    setView(next);
    setMeasurementMapZone(null);
    setMobileNav(false);
    setError("");
    setEstimate(null);
  };
  const selectZone = (id: string) => {
    setSelected(id);
    setReadingFeedback("");
    setEstimate(null);
  };
  const openMeasurementMap = () => {
    selectZone(zone.id);
    go("map");
    setMeasurementMapZone(zone.id);
  };
  const openZone = (id: string) => {
    selectZone(id);
    go("zone");
  };
  async function run(
    task: () => Promise<unknown>,
    message: string,
    close = true,
  ) {
    setBusy(true);
    setError("");
    try {
      await task();
      await load();
      setNotice(message);
      if (close) setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إكمال العملية");
    } finally {
      setBusy(false);
    }
  }
  const openReading = () => {
    if (canMeasure) setModal("reading");
    else setNotice("تسجيل القياسات متاح لفرق المسطحات الخضراء.");
  };
  const createRec = (id: string) =>
    run(
      () => api(`/zones/${id}/recommendations`, { method: "POST" }),
      "تم إنشاء توصية من القراءات الحالية.",
    );
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const val = (key: string) => String(f.get(key) || "");
    if (modal === "reading") {
      const point = val("point");
      const time = val("time")
        ? new Date(`${val("time")}:00+03:00`).toISOString()
        : new Date().toISOString();
      const body = {
        id: crypto.randomUUID(),
        ...(point === "new"
          ? { x: Number(val("x")), y: Number(val("y")) }
          : { point_id: point }),
        value: Number(val("value")),
        unit: val("unit"),
        measured_at: time,
        source: val("source"),
        operator: val("operator"),
        quality: val("quality"),
        origin: "simulation",
      };
      run(async () => {
        const updated = await api<Zone>(
          `/zones/${zone.id}/measurements`,
          post(body),
        );
        const message = `حُفظت القراءة. نقاط القياس الصالحة: ${number(zone.decision.coverage.active_points)} ← ${number(updated.decision.coverage.active_points)}. ${simpleState(updated).text}`;
        setZones((previous) =>
          previous.map((item) => (item.id === updated.id ? updated : item)),
        );
        setDataVersion((value) => value + 1);
        setModal(null);
        setReadingFeedback(message);
        if (view === "overview") {
          setGuideChosen(true);
          setGuideStep(
            ["insufficient", "measure", "conflict"].includes(
              updated.decision.code,
            )
              ? 2
              : 3,
          );
        }
      }, "تم حفظ القراءة وإعادة تقييم المنطقة.");
    } else if (modal === "inspection")
      run(
        () =>
          api(
            `/zones/${zone.id}/inspections`,
            post({
              id: crypto.randomUUID(),
              notes: val("notes"),
              operator: val("operator"),
            }),
          ),
        "تم تسجيل الفحص.",
      );
    else if (modal === "execute")
      run(
        () =>
          api(
            "/irrigation-events",
            post({
              id: crypto.randomUUID(),
              recommendation_id: executeId,
              volume: Number(val("volume")),
              unit: val("unit"),
              volume_kind: val("kind"),
              executed_at: new Date().toISOString(),
              operator: val("operator"),
              notes: val("notes"),
            }),
          ),
        "تم تسجيل التنفيذ وتحديث تقرير المياه.",
      );
  }
  const needs = zones
    .filter((z) =>
      ["measure", "conflict", "insufficient"].includes(z.decision.code),
    )
    .sort(
      (a, b) => b.decision.inspection_priority - a.decision.inspection_priority,
    );
  const currentRec = recs.find(
    (r) =>
      r.zone_id === zone?.id &&
      r.revision === zone?.revision &&
      ["suggested", "approved"].includes(r.status),
  );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="brand">
          <BrandLogo eager />
          <span>
            {display(canOperate ? "إدارة المسطحات الخضراء" : "نباتك يبدأ هنا")}
          </span>
        </div>
        <nav aria-label={display("التنقل الرئيسي")}>
          {display(
            nav.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={
                  view === n.id || (view === "zone" && n.id === "map")
                    ? "active"
                    : ""
                }
              >
                <n.icon size={20} />
                {display(n.label)}
              </button>
            )),
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="anbit-profile">
            <strong>{display(profile.name)}</strong>
            <small>
              {display(
                canMeasure
                  ? "فرق المسطحات الخضراء · إدارة الموقع"
                  : "الأفراد · اكتشاف النباتات",
              )}
            </small>
            <button type="button" onClick={onLogout}>
              <LogOut size={15} />
              {display(" تسجيل الخروج ")}
            </button>
          </div>
          <div className="demo-mark">
            <i />
            {display(" بيئة عرض تجريبية ")}
          </div>
          <p>
            {display(" نقيس أولًا. ")}
            <br />
            {display(" ثم نقرر بعناية. ")}
          </p>
          <small>
            {display(" تحدي إكسبو الرياض 2030 ")}
            <br />
            {display(" نموذج فريق أنبت • المسار 2.1 ")}
          </small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label={display("القائمة")}
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu />
            </button>
            <BrandLogo variant="navigation" />
            <ChevronLeft size={14} />
            <strong>
              {display(
                view === "zone"
                  ? zone?.name
                  : nav.find((n) => n.id === view)?.label,
              )}
            </strong>
          </div>
          <div className="topbar-preferences">
            <PreferencesControls />
            {canOperate && (
              <span className="demo-disclosure">
                <Info size={14} />
                {display(" الموقع محاكاة ")}
              </span>
            )}
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <h1>
                {display(
                  view === "overview"
                    ? canMeasure
                      ? "إدارة المسطحات الخضراء"
                      : "ماذا أزرع في مدينتي وكيف أزرعه؟"
                    : view === "zone"
                      ? zone?.name
                      : nav.find((n) => n.id === view)?.label,
                )}
              </h1>
              <p>
                {display(
                  view === "overview"
                    ? canMeasure
                      ? "من القياس إلى القرار."
                      : "اختر مدينة، ثم نباتًا، واتبع دليل زراعته."
                    : view === "map"
                      ? canOperate
                        ? "أين تتوفر المعلومات، وأين نحتاج إلى قياس آخر؟"
                        : "عناية بسيطة بالتربة والأصص المنزلية."
                      : view === "zone"
                        ? "من القراءة إلى قرار مفهوم وقابل للمراجعة"
                        : view === "decisions"
                          ? "اعتماد التوصية خطوة مستقلة عن تنفيذ الري"
                          : view === "water"
                            ? "المياه المسجّلة في عمليات التنفيذ التجريبية"
                            : "أنبت | ANBIT — معلومات النباتات ومؤشرات الملاءمة القواعدية",
                )}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="icon-button"
                aria-label={display("تحديث البيانات")}
                disabled={busy}
                onClick={() => run(load, "تم تحديث البيانات.")}
              >
                <RefreshCw size={18} />
              </button>
              {display(
                canMeasure && zone && view !== "overview" && (
                  <button className="primary" onClick={openReading}>
                    <Plus size={18} />
                    {display(" إضافة قراءة ")}
                  </button>
                ),
              )}
            </div>
          </div>
          {display(
            error && (
              <div role="alert" className="message error">
                <AlertTriangle size={18} />
                {display(error)}
                <button onClick={() => run(load, "تم الاتصال بنجاح.")}>
                  {display(" إعادة المحاولة ")}
                </button>
              </div>
            ),
          )}
          {display(
            notice && (
              <div role="status" className="message success">
                <Check size={17} />
                {display(notice)}
                <button
                  className="icon-button"
                  aria-label={display("إغلاق التنبيه")}
                  onClick={() => setNotice("")}
                >
                  <X size={16} />
                </button>
              </div>
            ),
          )}
          {display(
            !canOperate && view === "overview" ? (
              <IndividualHome />
            ) : !canOperate && view === "map" ? (
              <BeginnerSoilGuide />
            ) : loading ? (
              <div
                className="skeleton"
                aria-label={display("جار تحميل البيانات")}
              >
                <div />
                <div />
                <div />
              </div>
            ) : zone && report ? (
              <>
                {display(
                  view === "overview" && (
                    <>
                      <LandscapeHome
                        key={`${zone.id}:${zone.revision}:${dataVersion}`}
                        zones={zones}
                        zone={zone}
                        busy={busy}
                        onSelect={selectZone}
                        onReading={openReading}
                        onReview={() => openZone(zone.id)}
                        onMap={openMeasurementMap}
                        onDecisions={() => go("decisions")}
                      >
                        <details className="panel">
                          <summary>
                            {display("تفاصيل حالة المنطقة والحساب الحالي")}
                          </summary>
                          <Status decision={zone.decision} />
                          <p>{display(zone.decision.reason)}</p>
                          <p>
                            {display("التغطية الهندسية")}:{" "}
                            {number(zone.decision.coverage.fraction * 100)}% ·{" "}
                            {display("قراءات صالحة")}:{" "}
                            {zone.decision.readings_used.length}
                          </p>
                          {zone.decision.missing.map((item) => (
                            <p key={item}>{display(item)}</p>
                          ))}
                          {zone.decision.rejected.map((item) => (
                            <p key={item.id}>{display(item.reason)}</p>
                          ))}
                          <p>
                            {display("كمية الري الحسابية:")}{" "}
                            {zone.decision.estimate
                              ? `${number(zone.decision.estimate.gross_l)} ${display("لتر")}`
                              : display("أكمل الإعدادات")}
                          </p>
                          {zone.decision.estimate && (
                            <p>{display(zone.decision.estimate.formula)}</p>
                          )}
                          <button onClick={() => openZone(zone.id)}>
                            {display("افتح سجل المنطقة وجميع الإجراءات")}
                          </button>
                        </details>
                        <details className="quick-guided-extra">
                          <summary>{display("أحتاج شرحًا خطوة بخطوة")}</summary>
                          <GuidedEvaluation
                            zones={zones}
                            zone={zone}
                            step={guideStep}
                            chosen={guideChosen}
                            onStep={setGuideStep}
                            onChoose={(id) => {
                              selectZone(id);
                              setGuideChosen(true);
                              setGuideStep(2);
                            }}
                            onReading={openReading}
                            onTwin={() => go("map")}
                            onOperations={() => openZone(zone.id)}
                            busy={busy}
                            feedback={readingFeedback}
                            canMeasure={canMeasure}
                            homeMode
                          />
                        </details>
                        <details className="guide-advanced">
                          <summary>
                            {display(
                              "لوحة المتابعة التفصيلية: المؤشرات والخريطة وأولوية الفحص",
                            )}
                          </summary>
                          <p>
                            {zones.length} {display("مناطق الحديقة")} ·{" "}
                            {needs.length} {display("تحتاج قياسًا أو فحصًا")}
                          </p>
                          <div className="overview-grid">
                            <SiteMap
                              zones={zones}
                              selected={selected}
                              onSelect={selectZone}
                            />
                            <section className="panel priorities">
                              <h2>{display("أين نقيس أولًا؟")}</h2>
                              <div className="priority-list">
                                {needs.map((item, i) => (
                                  <button
                                    key={item.id}
                                    onClick={() => selectZone(item.id)}
                                  >
                                    <span className="rank">
                                      {number(i + 1)}
                                    </span>
                                    <div>
                                      <strong>{display(item.name)}</strong>
                                      <Status decision={item.decision} />
                                    </div>
                                  </button>
                                ))}
                              </div>
                              <button onClick={() => openZone(zone.id)}>
                                {display("عرض المنطقة")}
                              </button>
                            </section>
                          </div>
                          <ZoneTable zones={zones} onOpen={openZone} />
                        </details>
                      </LandscapeHome>
                    </>
                  ),
                )}
                {display(
                  view === "map" && (
                    <>
                      {display(
                        guideChosen && (
                          <button
                            className="guide-return"
                            onClick={() => go("overview")}
                          >
                            {display(" العودة إلى خطوات تقييم المنطقة ")}
                          </button>
                        ),
                      )}
                      {measurementMapZone && (
                        <div className="measurement-map-context">
                          <h2>
                            {display("أين أقيس؟")} · {display(zone.name)}
                          </h2>
                          <button onClick={() => setMeasurementMapZone(null)}>
                            {display("عرض كل المناطق")}
                          </button>
                        </div>
                      )}
                      <SiteMap
                        key={`map:${measurementMapZone ?? "all"}`}
                        zones={measurementMapZone ? [zone] : zones}
                        selected={selected}
                        onSelect={(id) => {
                          selectZone(id);
                          setGuideChosen(true);
                          setGuideStep(2);
                        }}
                        measurementFocus={!!measurementMapZone}
                        focusSuggested={!!measurementMapZone}
                        onReading={canMeasure ? openReading : undefined}
                        large
                      />
                      <div className="map-zone-summary" aria-live="polite">
                        <div>
                          <span className="quick-eyebrow">
                            {display(" المنطقة التي اخترتها ")}
                          </span>
                          <h2>{display(zone.name)}</h2>
                          <strong>{display(simpleState(zone).title)}</strong>
                          <p>{display(simpleState(zone).text)}</p>
                          <small>
                            {display(
                              " اختر نقطة على الخريطة لعرض معلوماتها. فجوات التغطية ونقاط القياس بلا قراءات متاحة ضمن الطبقات الاختيارية. ",
                            )}
                          </small>
                        </div>
                        <div className="quick-buttons">
                          {display(
                            canMeasure && (
                              <button className="primary" onClick={openReading}>
                                <Plus size={17} />
                                {display(" إضافة قراءة تربة ")}
                              </button>
                            ),
                          )}
                          <button onClick={() => openZone(zone.id)}>
                            {display(" تفاصيل القرار ")}
                          </button>
                        </div>
                      </div>
                      <details className="map-twin-access">
                        <summary>
                          {display(
                            " افتح التوأم الرقمي وجرّب سيناريو ري افتراضي ",
                          )}
                        </summary>
                        <p className="quick-provenance">
                          {display(
                            " المحاكاة حسابية ولا تحفظ ريًا أو تغيّر قراءة محفوظة. ",
                          )}
                        </p>
                        <DigitalTwin
                          key={`${dataVersion}:${zone.id}:${zone.revision}:${zone.decision.readings_used.join(",")}:${recs.map((r) => r.id + r.status).join(",")}`}
                          zone={zone}
                          recommendation={recs.find(
                            (r) =>
                              r.zone_id === zone.id &&
                              r.revision === zone.revision &&
                              r.result.code === zone.decision.code &&
                              r.result.readings_used.join(",") ===
                                zone.decision.readings_used.join(","),
                          )}
                          onReading={openReading}
                          onDetails={() => openZone(zone.id)}
                          canMeasure={canMeasure}
                        />
                      </details>
                    </>
                  ),
                )}
                {canMeasure && view === "measurements" && (
                  <SurveyHome
                    zones={zones}
                    zone={zone}
                    onSelect={selectZone}
                    onReading={openReading}
                    onDetails={() => openZone(zone.id)}
                    busy={busy}
                    feedback={readingFeedback}
                  />
                )}
                {display(
                  view === "zone" && (
                    <>
                      <div className="zone-tabs">
                        {display(
                          zones.map((z) => (
                            <button
                              key={z.id}
                              onClick={() => selectZone(z.id)}
                              className={selected === z.id ? "selected" : ""}
                            >
                              {display(z.name)}
                            </button>
                          )),
                        )}
                      </div>
                      <div className="zone-facts">
                        <span>
                          <Leaf size={17} />
                          {display(zone.plant.name)}
                        </span>
                        <span>{display(zone.soil.name)}</span>
                        <span>
                          {display(number(zone.area_m2))}
                          {display(" م² ")}
                        </span>
                        <span>
                          {display(" الري: ")}
                          {display(zone.method)}
                        </span>
                      </div>
                      <div className="zone-grid">
                        <section className="panel decision-panel">
                          <div className="section-title">
                            <h2>{display(" تقييم المنطقة الآن ")}</h2>
                            <Status decision={zone.decision} />
                          </div>
                          <h3>{display(zone.decision.reason)}</h3>
                          <p className="subtle">
                            {display(zone.decision.validity)}
                          </p>
                          <div className="decision-numbers">
                            <div>
                              <small>
                                {display(" متوسط القراءات الصالحة ")}
                              </small>
                              <strong>
                                {display(
                                  zone.decision.mean_vwc === null
                                    ? "غير متاح"
                                    : `${number(zone.decision.mean_vwc * 100)}%`,
                                )}
                              </strong>
                            </div>
                            <div>
                              <small>{display(" التغطية الهندسية ")}</small>
                              <strong>
                                {display(
                                  number(zone.decision.coverage.fraction * 100),
                                )}
                                %
                              </strong>
                            </div>
                          </div>
                          <p className="footnote">
                            {display(
                              " التغطية ليست نسبة ثقة علمية. حد العرض: ",
                            )}
                            {display(" ")}
                            {display(
                              number(
                                zone.decision.coverage.required_fraction * 100,
                              ),
                            )}
                            {display(" % ضمن نصف قطر ")}
                            {display(number(zone.decision.coverage.radius_m))}
                            {display(" ")}
                            {display(" م. ")}
                          </p>
                          {display(
                            zone.decision.missing.length > 0 && (
                              <div className="inset warning">
                                <strong>
                                  {display(" المعلومات المطلوبة ")}
                                </strong>
                                <ul>
                                  {display(
                                    zone.decision.missing.map((m) => (
                                      <li key={m}>{display(m)}</li>
                                    )),
                                  )}
                                </ul>
                              </div>
                            ),
                          )}
                          <details>
                            <summary>
                              {display(" كيف وصل أنبت إلى هذا القرار؟ ")}
                            </summary>
                            <p>
                              {display(" القراءات المستخدمة: ")}
                              {display(" ")}
                              {display(
                                number(zone.decision.readings_used.length),
                              )}
                              {display(" . المصادر: ")}
                              {display(" ")}
                              {display(
                                zone.decision.sources.join("، ") || "غير متاحة",
                              )}
                              .
                            </p>
                            <p>
                              {display(" حدود المنطقة التجريبية: ")}
                              {display(" ")}
                              {display(number(zone.soil.lower_vwc * 100))}
                              {display(" % إلى ")}
                              {display(" ")}
                              {display(number(zone.soil.upper_vwc * 100))}
                              {display(" %، المستهدف ")}
                              {display(" ")}
                              {display(number(zone.soil.target_vwc * 100))}%.
                            </p>
                            <p>
                              {display(" القراءات المستبعدة: ")}
                              {display(" ")}
                              {display(
                                zone.decision.rejected
                                  .map((r) => r.reason)
                                  .join("، ") || "لا يوجد",
                              )}
                              .
                            </p>
                            <code dir="ltr">
                              {display(zone.decision.rules.join(" → "))}
                            </code>
                            <p>{display(zone.decision.caveats.join(" "))}</p>
                          </details>
                          <div className="actions">
                            {display(
                              canOperate && (
                                <button
                                  className="primary"
                                  disabled={busy}
                                  onClick={() => createRec(zone.id)}
                                >
                                  <Leaf size={16} />
                                  {display(" طلب توصية جديدة ")}
                                </button>
                              ),
                            )}
                            {display(
                              canMeasure && (
                                <button
                                  disabled={busy}
                                  onClick={() => setModal("inspection")}
                                >
                                  <ClipboardCheck size={16} />
                                  {display(" تسجيل فحص ")}
                                </button>
                              ),
                            )}
                          </div>
                          {display(
                            currentRec && (
                              <div className="inset">
                                <span>
                                  {display(" التوصية: ")}
                                  {display(stateLabels[currentRec.status])}
                                </span>
                                {display(
                                  canOperate && (
                                    <div className="actions">
                                      {display(
                                        currentRec.status === "suggested" &&
                                          zone.decision.code === "review" && (
                                            <button
                                              disabled={busy}
                                              onClick={() =>
                                                run(
                                                  () =>
                                                    api(
                                                      `/recommendations/${currentRec.id}`,
                                                      {
                                                        method: "PATCH",
                                                        body: JSON.stringify({
                                                          status: "approved",
                                                          operator:
                                                            "مشرف العرض",
                                                        }),
                                                      },
                                                    ),
                                                  "تم الاعتماد فقط؛ لم تُسجّل مياه.",
                                                )
                                              }
                                            >
                                              <Check size={16} />
                                              {display(" اعتماد الري ")}
                                            </button>
                                          ),
                                      )}
                                      {display(
                                        currentRec.status === "approved" && (
                                          <button
                                            className="primary"
                                            onClick={() => {
                                              setExecuteId(currentRec.id);
                                              setModal("execute");
                                            }}
                                          >
                                            {display(" تسجيل تنفيذ الري ")}
                                          </button>
                                        ),
                                      )}
                                      <button
                                        disabled={busy}
                                        onClick={() =>
                                          run(
                                            () =>
                                              api(
                                                `/recommendations/${currentRec.id}`,
                                                {
                                                  method: "PATCH",
                                                  body: JSON.stringify({
                                                    status: "deferred",
                                                    operator: "مشرف العرض",
                                                  }),
                                                },
                                              ),
                                            "تم تأجيل التوصية.",
                                          )
                                        }
                                      >
                                        {display(" تأجيل ")}
                                      </button>
                                    </div>
                                  ),
                                )}
                              </div>
                            ),
                          )}
                        </section>
                        <div>
                          <SiteMap
                            zones={[zone]}
                            selected={selected}
                            onSelect={selectZone}
                          />
                          <div className="inset next-point">
                            <ScanLine size={22} />
                            <div>
                              <strong>
                                {display(" الفحص التالي المقترح ")}
                              </strong>
                              <p>
                                {display(
                                  zone.decision.coverage.next_point.reason,
                                )}
                              </p>
                              <small>
                                {display(" س: ")}
                                {display(
                                  number(zone.decision.coverage.next_point.x),
                                )}
                                {display(" م، ص: ")}
                                {display(
                                  number(zone.decision.coverage.next_point.y),
                                )}
                                {display(" م ")}
                              </small>
                              {display(
                                canMeasure && (
                                  <button
                                    className="text-button"
                                    onClick={openReading}
                                  >
                                    {display(" إضافة قراءة هنا ")}
                                    <Plus size={15} />
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bottom-grid">
                        <section className="panel">
                          <div className="section-title">
                            <h2>{display(" سجل الرطوبة الحجمية ")}</h2>
                            <span className="subtle">
                              {display(" كل نقطة تمثل قراءة ")}
                            </span>
                          </div>
                          <MoistureChart readings={zone.measurements} />
                          <p className="footnote">
                            {display(
                              " النقاط الخام لا تظهر كنسبة مئوية. الرسم يعرض التاريخ، ويستخدم القرار القراءات الصالحة فقط. ",
                            )}
                          </p>
                        </section>
                        <section className="panel">
                          <h2>{display(" تقدير احتياج المياه ")}</h2>
                          <EstimateView decision={estimate || zone.decision} />
                          <details>
                            <summary>
                              {display(" اختبار افتراضات المحاكاة ")}
                            </summary>
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const f = new FormData(e.currentTarget);
                                run(
                                  async () => {
                                    const r = await api<Decision>(
                                      `/zones/${zone.id}/estimate`,
                                      post({
                                        irrigated_area_m2: Number(
                                          f.get("area"),
                                        ),
                                        root_depth_m: Number(f.get("depth")),
                                        efficiency: Number(f.get("efficiency")),
                                        root_representative:
                                          f.get("roots") === "on",
                                        homogeneous: true,
                                      }),
                                    );
                                    setEstimate(r);
                                  },
                                  "تم حساب السيناريو دون تغيير إعدادات المنطقة.",
                                  false,
                                );
                              }}
                            >
                              <div className="form-grid">
                                <label>
                                  {display(" مساحة الري م² ")}
                                  <input
                                    name="area"
                                    type="number"
                                    min="1"
                                    max={zone.area_m2}
                                    defaultValue={zone.irrigated_area_m2}
                                    required
                                  />
                                </label>
                                <label>
                                  {display(" عمق الجذور م ")}
                                  <input
                                    name="depth"
                                    type="number"
                                    step=".01"
                                    min=".01"
                                    max="3"
                                    defaultValue={zone.root_depth_m}
                                    required
                                  />
                                </label>
                                <label>
                                  {display(" الكفاءة (0–1) ")}
                                  <input
                                    name="efficiency"
                                    type="number"
                                    step=".01"
                                    min=".01"
                                    max="1"
                                    defaultValue={zone.efficiency}
                                    required
                                  />
                                </label>
                              </div>
                              <label className="checkbox">
                                <input
                                  name="roots"
                                  type="checkbox"
                                  defaultChecked
                                />
                                {display(
                                  " افتراض تمثيل القياسات لكامل عمق الجذور ",
                                )}
                              </label>
                              <button disabled={busy}>
                                {display(" حساب تقدير المحاكاة ")}
                              </button>
                            </form>
                          </details>
                        </section>
                      </div>
                      <section className="panel table-panel">
                        <h2>{display(" القراءات المسجّلة ")}</h2>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>{display(" النقطة ")}</th>
                                <th>{display(" القيمة ")}</th>
                                <th>{display(" الوحدة ")}</th>
                                <th>{display(" الوقت · الرياض ")}</th>
                                <th>{display(" المصدر ")}</th>
                                <th>{display(" الجودة ")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {display(
                                zone.measurements.map((m) => (
                                  <tr key={m.id}>
                                    <td>
                                      {display(
                                        zone.points.find(
                                          (p) => p.id === m.point_id,
                                        )?.name,
                                      )}
                                    </td>
                                    <td>{display(number(m.value))}</td>
                                    <td>
                                      {display(
                                        m.unit === "raw"
                                          ? "خام"
                                          : m.unit === "vwc_percent"
                                            ? "% حجمية"
                                            : "م³/م³",
                                      )}
                                    </td>
                                    <td>{display(date(m.measured_at))}</td>
                                    <td>
                                      {display(m.source)}
                                      <small className="block">
                                        {display(" محاكاة · ")}
                                        {display(m.operator)}
                                      </small>
                                    </td>
                                    <td>
                                      {display(
                                        m.quality === "verified"
                                          ? "متحققة في المحاكاة"
                                          : m.quality === "suspect"
                                            ? "مشتبه بها"
                                            : "غير متحققة",
                                      )}
                                    </td>
                                  </tr>
                                )),
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>
                      <section className="panel table-panel">
                        <h2>{display(" سجل الفحص والري ")}</h2>
                        {display(
                          inspections.length === 0 &&
                            !report.events.some(
                              (e) => e.zone_id === zone.id,
                            ) ? (
                            <p className="subtle">
                              {display(
                                " لا توجد إجراءات مسجلة لهذه المنطقة بعد. ",
                              )}
                            </p>
                          ) : (
                            <>
                              {display(
                                inspections.map((i) => (
                                  <p key={i.id}>
                                    <ClipboardCheck size={16} />{" "}
                                    {display(i.notes)} ·{display(" ")}
                                    {display(i.operator)} ·{" "}
                                    {display(date(i.created_at))}
                                  </p>
                                )),
                              )}
                              {display(
                                report.events
                                  .filter((e) => e.zone_id === zone.id)
                                  .map((e) => (
                                    <p key={e.id}>
                                      <Droplets size={16} />{" "}
                                      {display(number(e.volume_l))}
                                      {display(" لتر · ")}
                                      {display(" ")}
                                      {display(date(e.executed_at))} ·{" "}
                                      {display(e.operator)}
                                    </p>
                                  )),
                              )}
                            </>
                          ),
                        )}
                      </section>
                    </>
                  ),
                )}
                {display(
                  view === "decisions" && (
                    <>
                      <div className="inset info">
                        <Info size={19} />
                        <p>
                          {display(
                            " الاعتماد لا يشغّل مضخة ولا يحتسب استهلاكًا. تُضاف المياه إلى التقرير فقط عند تسجيل تنفيذ الري. ",
                          )}
                        </p>
                      </div>
                      <section className="panel">
                        <h2>{display(" حالات المناطق ")}</h2>
                        <ZoneTable zones={zones} onOpen={openZone} />
                      </section>
                      <section className="panel table-panel">
                        <h2>{display(" سجل التوصيات ")}</h2>
                        {display(
                          recs.length === 0 ? (
                            <div className="empty-state">
                              <Leaf size={32} />
                              <h3>{display(" ابدأ بتقييم إحدى المناطق ")}</h3>
                              <p>
                                {display(
                                  " افتح المنطقة واطلب توصية مبنية على قراءاتها الحالية. ",
                                )}
                              </p>
                            </div>
                          ) : (
                            <div className="table-scroll">
                              <table>
                                <thead>
                                  <tr>
                                    <th>{display(" المنطقة ")}</th>
                                    <th>{display(" القرار ")}</th>
                                    <th>{display(" الحالة ")}</th>
                                    <th>{display(" الوقت ")}</th>
                                    <th>{display(" الإجراء ")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {display(
                                    recs.map((r) => (
                                      <tr key={r.id}>
                                        <td>
                                          {display(
                                            zones.find(
                                              (z) => z.id === r.zone_id,
                                            )?.name,
                                          )}
                                        </td>
                                        <td>
                                          <Status decision={r.result} />
                                        </td>
                                        <td>
                                          {display(stateLabels[r.status])}
                                          {display(
                                            zones.find(
                                              (z) => z.id === r.zone_id,
                                            )?.revision !== r.revision &&
                                              r.status !== "executed" && (
                                                <small className="block">
                                                  {display(
                                                    " تحتاج إعادة تقييم ",
                                                  )}
                                                </small>
                                              ),
                                          )}
                                        </td>
                                        <td>{display(date(r.created_at))}</td>
                                        <td>
                                          <button
                                            className="small"
                                            onClick={() => openZone(r.zone_id)}
                                          >
                                            {display(" مراجعة ")}
                                          </button>
                                        </td>
                                      </tr>
                                    )),
                                  )}
                                </tbody>
                              </table>
                            </div>
                          ),
                        )}
                      </section>
                    </>
                  ),
                )}
                {display(
                  view === "water" && (
                    <>
                      <div className="report-controls">
                        <label>
                          {display(" الفترة ")}
                          <select
                            value={days}
                            onChange={(e) => setDays(Number(e.target.value))}
                          >
                            <option value="7">{display(" آخر 7 أيام ")}</option>
                            <option value="30">
                              {display(" آخر 30 يومًا ")}
                            </option>
                            <option value="90">
                              {display(" آخر 90 يومًا ")}
                            </option>
                          </select>
                        </label>
                        <span className="subtle">
                          {display("السيناريوهات لا تدخل استهلاك التقرير")}
                        </span>
                      </div>
                      <ExecutiveReport key={days} days={days} />
                      <details className="legacy-water-details">
                        <summary>
                          {display("تفاصيل سجل المحاكاة والرسوم السابقة")}
                        </summary>
                        <section className="metrics">
                          <div>
                            <span>{display(" إجمالي المياه ")}</span>
                            <strong>
                              {display(number(report.total_l))}
                              <em>{display(" لتر ")}</em>
                            </strong>
                          </div>
                          <div>
                            <span>{display(" كميات مقاسة في المحاكاة ")}</span>
                            <strong>
                              {display(number(report.measured_l))}
                              <em>{display(" لتر ")}</em>
                            </strong>
                          </div>
                          <div>
                            <span>{display(" كميات مقدّرة في المحاكاة ")}</span>
                            <strong>
                              {display(number(report.estimated_l))}
                              <em>{display(" لتر ")}</em>
                            </strong>
                          </div>
                        </section>
                        <div className="bottom-grid">
                          <section className="panel">
                            <h2>{display(" الاستخدام عبر الزمن ")}</h2>
                            <WaterChart report={report} />
                          </section>
                          <section className="panel">
                            <h2>{display(" الاستخدام بحسب المنطقة ")}</h2>
                            <div className="table-scroll">
                              <table>
                                <thead>
                                  <tr>
                                    <th>{display(" المنطقة ")}</th>
                                    <th>{display(" لتر ")}</th>
                                    <th>{display(" لتر/م² ")}</th>
                                    <th>{display(" العمليات ")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {display(
                                    report.by_zone.map((z) => (
                                      <tr key={z.id}>
                                        <td>{display(z.name)}</td>
                                        <td>{display(number(z.litres))}</td>
                                        <td>
                                          {display(number(z.litres_per_m2))}
                                        </td>
                                        <td>{display(number(z.events))}</td>
                                      </tr>
                                    )),
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </section>
                        </div>
                        <section className="panel table-panel">
                          <h2>{display(" عمليات الري المنفّذة ")}</h2>
                          {display(
                            report.events.length ? (
                              <div className="table-scroll">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>{display(" المنطقة ")}</th>
                                      <th>{display(" الكمية ")}</th>
                                      <th>{display(" طريقة التوثيق ")}</th>
                                      <th>{display(" الوقت ")}</th>
                                      <th>{display(" المسجّل ")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {display(
                                      report.events.map((e) => (
                                        <tr key={e.id}>
                                          <td>
                                            {display(
                                              zones.find(
                                                (z) => z.id === e.zone_id,
                                              )?.name,
                                            )}
                                          </td>
                                          <td>
                                            {display(number(e.volume_l))}
                                            {display(" لتر ")}
                                          </td>
                                          <td>
                                            {display(
                                              e.volume_kind === "measured"
                                                ? "مقاسة"
                                                : "مقدّرة",
                                            )}
                                            {display(" ")}
                                            {display(" · محاكاة ")}
                                          </td>
                                          <td>
                                            {display(date(e.executed_at))}
                                          </td>
                                          <td>{display(e.operator)}</td>
                                        </tr>
                                      )),
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p>
                                {display(" لا توجد عمليات في الفترة المحددة. ")}
                              </p>
                            ),
                          )}
                          <p className="footnote">
                            {display(report.limitations)}
                            {display(
                              " عدم وجود سجلات لا يثبت عدم استخدام مياه خارج النظام. لا تتوفر فترة مقارنة موثقة. ",
                            )}
                          </p>
                        </section>
                      </details>
                    </>
                  ),
                )}
                {display(
                  view === "plants" && (
                    <>
                      {canOperate && <PlantCityExplorer />}
                      <PlantGuide plants={plants} />
                    </>
                  ),
                )}
                <footer>
                  {display(" أنبت — نقيس أولًا، ثم نقرر بعناية. ")}
                  <span>
                    {display(" آخر تقييم: ")}
                    {display(date(zone.decision.evaluated_at))}
                    {display(" · توقيت الرياض ")}
                  </span>
                </footer>
              </>
            ) : (
              !loading && (
                <div className="empty-state">
                  {display(
                    " لم تتوفر بيانات الموقع. استخدم إعادة المحاولة للاتصال بالخادم. ",
                  )}
                </div>
              )
            ),
          )}
        </div>
      </main>
      <dialog
        ref={dialog}
        onCancel={() => setModal(null)}
        onClose={() => setModal(null)}
      >
        <div className="dialog-heading">
          <h2>
            {display(
              modal === "reading"
                ? "إضافة قراءة تربة"
                : modal === "inspection"
                  ? "تسجيل فحص"
                  : modal === "execute"
                    ? "تسجيل تنفيذ الري"
                    : "إجراء الموقع",
            )}
          </h2>
          <button
            className="icon-button"
            aria-label={display("إغلاق النافذة")}
            onClick={() => setModal(null)}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </div>
        {display(
          error && (
            <div role="alert" className="message error">
              {display(error)}
            </div>
          ),
        )}
        {display(
          zone && (
            <form onSubmit={onSubmit}>
              <p className="subtle">
                {display(zone.name)}
                {display(" · بيانات محاكاة معلنة ")}
              </p>
              {display(modal === "reading" && <ReadingFields zone={zone} />)}
              <input
                name="operator"
                type="hidden"
                value={profile.name}
                readOnly
              />
              <p className="anbit-role-hint">
                {display(" تُسجل العملية باسم حسابك: ")}
                {display(profile.name)}
              </p>
              {display(
                modal === "inspection" && (
                  <label>
                    {display(" ملاحظات الفحص ")}
                    <textarea
                      name="notes"
                      required
                      minLength={3}
                      maxLength={1000}
                      placeholder={display("ماذا فحصت، وما الذي لاحظته؟")}
                    />
                  </label>
                ),
              )}
              {display(
                modal === "execute" && (
                  <>
                    <div className="inset warning">
                      {display(
                        " تسجيل عملية تمت بالفعل داخل سيناريو المحاكاة. لا يتحكم هذا الإجراء بمضخة. ",
                      )}
                    </div>
                    <div className="form-grid">
                      <label>
                        {display(" الكمية المنفّذة ")}
                        <input
                          type="number"
                          name="volume"
                          min=".01"
                          max="1000000"
                          step=".01"
                          required
                        />
                      </label>
                      <label>
                        {display(" الوحدة ")}
                        <select name="unit">
                          <option value="L">{display(" لتر ")}</option>
                          <option value="m3">{display(" متر مكعب ")}</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      {display(" مصدر الكمية ")}
                      <select name="kind">
                        <option value="measured">
                          {display(" كمية مقاسة في المحاكاة ")}
                        </option>
                        <option value="estimated">
                          {display(" كمية مقدّرة في المحاكاة ")}
                        </option>
                      </select>
                    </label>
                    <label>
                      {display(" ملاحظات ")}
                      <textarea name="notes" maxLength={1000} />
                    </label>
                  </>
                ),
              )}
              <div className="actions">
                <button className="primary" disabled={busy} type="submit">
                  {display(
                    busy
                      ? "جار الحفظ…"
                      : modal === "reading"
                        ? "حفظ وإعادة التقييم"
                        : modal === "execute"
                          ? "تأكيد تسجيل التنفيذ"
                          : "حفظ الفحص",
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  disabled={busy}
                >
                  {display(" إلغاء ")}
                </button>
              </div>
            </form>
          ),
        )}
      </dialog>
    </div>
  );
}
function ReadingFields({ zone }: { zone: Zone }) {
  const suggested = suggestedMeasurement(zone);
  const [point, setPoint] = useState("new");
  return (
    <>
      <label>
        {display(" موقع القياس ")}
        <select
          name="point"
          value={point}
          onChange={(e) => setPoint(e.target.value)}
        >
          <option value="new">
            {display(
              suggested
                ? " نقطة إضافية — الموقع المقترح "
                : "نقطة إضافية — أدخل موقع القياس",
            )}
          </option>
          {display(
            zone.points.map((p) => (
              <option key={p.id} value={p.id}>
                {display(p.name)} ({display(p.x)}
                {display(" ، ")}
                {display(p.y)})
              </option>
            )),
          )}
        </select>
      </label>
      {display(
        point === "new" && (
          <div className="form-grid">
            <label>
              {display(" س · متر ")}
              <input
                name="x"
                type="number"
                step=".01"
                min={zone.x}
                max={zone.x + zone.width}
                defaultValue={suggested?.x ?? ""}
                required
              />
            </label>
            <label>
              {display(" ص · متر ")}
              <input
                name="y"
                type="number"
                step=".01"
                min={zone.y}
                max={zone.y + zone.height}
                defaultValue={suggested?.y ?? ""}
                required
              />
            </label>
          </div>
        ),
      )}
      <div className="form-grid">
        <label>
          {display(" قيمة القراءة ")}
          <input
            autoFocus
            name="value"
            type="number"
            step="any"
            min="0"
            required
            placeholder={display("مثلًا: 15")}
          />
        </label>
        <label>
          {display(" الوحدة ")}
          <select name="unit">
            <option value="vwc_percent">{display(" رطوبة حجمية % ")}</option>
            <option value="vwc_fraction">
              {display(" رطوبة حجمية م³/م³ ")}
            </option>
            <option value="raw">{display(" قيمة حساس خام ")}</option>
          </select>
        </label>
      </div>
      <label>
        {display(" وقت القياس · الرياض ")}
        <input type="datetime-local" name="time" />
        <small>{display(" اتركه فارغًا لاستخدام الوقت الحالي. ")}</small>
      </label>
      <label>
        {display(" مصدر القراءة ")}
        <input
          name="source"
          defaultValue="قياس يدوي ضمن المحاكاة"
          required
          minLength={2}
          maxLength={200}
        />
      </label>
      <label>
        {display(" الجودة ")}
        <select name="quality">
          <option value="verified">
            {display(" متحققة ضمن سيناريو المحاكاة ")}
          </option>
          <option value="unverified">{display(" غير متحققة ")}</option>
          <option value="suspect">{display(" مشتبه بها ")}</option>
        </select>
      </label>
    </>
  );
}
function ZoneTable({
  zones,
  onOpen,
}: {
  zones: Zone[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{display(" المنطقة ")}</th>
            <th>{display(" حالة المعلومات ")}</th>
            <th>{display(" المساحة ")}</th>
            <th>
              <span className="sr-only">{display(" التفاصيل ")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {display(
            zones.map((z) => (
              <tr key={z.id}>
                <td>
                  <button
                    className="text-button zone-link"
                    onClick={() => onOpen(z.id)}
                  >
                    {display(z.name)}
                  </button>
                  <small className="block">{display(z.plant.name)}</small>
                </td>
                <td>
                  <Status decision={z.decision} />
                </td>
                <td>
                  {display(number(z.area_m2))}
                  {display(" م² ")}
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={display(`تفاصيل ${z.name}`)}
                    onClick={() => onOpen(z.id)}
                  >
                    <ArrowUpLeft size={17} />
                  </button>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}
function EstimateView({ decision }: { decision: Decision }) {
  return decision.estimate ? (
    <>
      <div className="estimate-value">
        {display(number(decision.estimate.gross_l))}
        <span>{display(" لتر ")}</span>
      </div>
      <strong className="amber-text">{display(decision.estimate.label)}</strong>
      <p>
        {display(" صافي الاحتياج ")}
        {display(number(decision.estimate.net_l))}
        {display(" لتر؛ بعد احتساب كفاءة ")}
        {display(" ")}
        {display(number(decision.estimate.efficiency * 100))}%.
      </p>
      <p className="footnote">
        {display(decision.estimate.formula)}
        {display(" . المساحة ")}
        {display(number(decision.estimate.area_m2))}
        {display(" ")}
        {display(" م²، العمق ")}
        {display(number(decision.estimate.root_depth_m))}
        {display(
          " م. النتيجة مشروطة بصحة الافتراضات وليست توصية زراعية ميدانية. ",
        )}
      </p>
    </>
  ) : (
    <div className="empty-estimate">
      <Droplets size={27} />
      <p>
        {display(" لا تتوفر بيانات كافية أو حالة مناسبة لتقدير كمية الري. ")}
      </p>
      <small>
        {display(" عالج متطلبات القرار أولًا؛ لن تُعرض كمية افتراضية. ")}
      </small>
    </div>
  );
}
