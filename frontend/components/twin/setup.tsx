"use client";
import { useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import { CITIES, DEFAULT_ALLOWED, DEFAULT_SEED, DURATIONS, type City, type Season } from "../../lib/twin/constants";
import { defaultConfig, type SimConfig } from "../../lib/twin/engine";
import { useCopy } from "../landscape/copy";

type Length = "hours" | "days" | "weeks" | "custom";

export default function Setup({ initial, onStart }: { initial?: SimConfig; onStart: (c: SimConfig) => void }) {
  const c = useCopy();
  const base = initial ?? defaultConfig();
  const preset = (Object.entries(DURATIONS).find(([, d]) => d === base.days)?.[0] as Length) ?? "custom";
  const [length, setLength] = useState<Length>(preset);
  const [custom, setCustom] = useState(String(base.days));
  const [season, setSeason] = useState<Season>(base.season);
  const [city, setCity] = useState<City>(base.city ?? "riyadh");
  const [rain, setRain] = useState(base.rain);
  const [sections, setSections] = useState(base.sections);
  const [start, setStart] = useState(base.allowedStart);
  const [end, setEnd] = useState(base.allowedEnd);
  const [seed, setSeed] = useState(String(base.seed));
  const days = length === "custom" ? Math.max(1, Math.min(60, Math.round(Number(custom) || 1))) : DURATIONS[length];
  const lengths: { id: Length; ar: string; en: string }[] = [
    { id: "hours", ar: "ساعات · 24 س", en: "Hours · 24 h" },
    { id: "days", ar: "أيام · 7", en: "Days · 7" },
    { id: "weeks", ar: "أسابيع · 4", en: "Weeks · 4" },
    { id: "custom", ar: "مخصص", en: "Custom" },
  ];
  const seasons: { id: Season; ar: string; en: string }[] = [
    { id: "summer", ar: "صيف", en: "Summer" },
    { id: "winter", ar: "شتاء", en: "Winter" },
    { id: "spring", ar: "ربيع", en: "Spring" },
  ];
  const cities: { id: City; ar: string; en: string }[] = [
    { id: "riyadh", ar: "الرياض", en: "Riyadh" },
    { id: "jeddah", ar: "جدة", en: "Jeddah" },
    { id: "dammam", ar: "الدمام", en: "Dammam" },
    { id: "medina", ar: "المدينة", en: "Medina" },
    { id: "tabuk", ar: "تبوك", en: "Tabuk" },
    { id: "abha", ar: "أبها", en: "Abha" },
  ];
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <section className="tw-setup tw-card" aria-labelledby="tw-setup-title">
      <p className="tw-step">{c.t("الخطوة 1 من 3", "Step 1 of 3")}</p>
      <h1 id="tw-setup-title">{c.t("إعداد السيناريو", "Set up the scenario")}</h1>
      <p className="tw-lead">{c.t("نشغّل ثلاث طرق ري معًا على الطقس نفسه، ثم نقارن.", "Three ways of irrigating run together on the same weather, then we compare.")}</p>

      <fieldset>
        <legend>{c.t("المدة", "Duration")}</legend>
        <div className="tw-seg">
          {lengths.map((l) => (
            <button key={l.id} type="button" aria-pressed={length === l.id} onClick={() => setLength(l.id)}>
              {c.t(l.ar, l.en)}
            </button>
          ))}
        </div>
        {length === "custom" && (
          <label className="tw-inline">
            {c.t("عدد الأيام (1–60)", "Days (1–60)")}
            <input type="number" min={1} max={60} value={custom} onChange={(e) => setCustom(e.target.value)} dir="ltr" />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>{c.t("المدينة", "City")}</legend>
        <div className="tw-seg">
          {cities.map((x) => (
            <button key={x.id} type="button" aria-pressed={city === x.id} onClick={() => setCity(x.id)}>
              {c.t(x.ar, x.en)}
            </button>
          ))}
        </div>
        <p className="tw-caption">
          {c.t(
            `تبخر مرجعي ${c.num(CITIES[city].etRefMmDay, 1)} مم/يوم (${CITIES[city].etSource === "ENBT" ? "متوسط سنوي من قاعدة ENBT" : "افتراض بلا قيمة في ENBT"})، مطبّق كنسبة إلى الرياض فوق الموسم.`,
            `Reference ET ${CITIES[city].etRefMmDay} mm/day (${CITIES[city].etSource === "ENBT" ? "annual average from the ENBT database" : "assumption, no ENBT value"}), applied as a ratio to Riyadh on top of the season.`,
          )}
        </p>
      </fieldset>

      <fieldset>
        <legend>{c.t("الموسم", "Season")}</legend>
        <div className="tw-seg">
          {seasons.map((s) => (
            <button key={s.id} type="button" aria-pressed={season === s.id} onClick={() => setSeason(s.id)}>
              {c.t(s.ar, s.en)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="tw-versus" aria-label={c.t("ما نختبره", "What we test")}>
        <span className="tw-chip tw-chip-anbit">{c.t("تلقائي بأنبت", "ANBIT automatic")}</span>
        <span className="tw-vs">{c.t("مقابل", "vs")}</span>
        <span className="tw-chip">{c.t("آلي بالحساسات فقط", "Sensor-only automation")}</span>
        <span className="tw-chip">{c.t("جدول ثابت", "Fixed schedule")}</span>
      </div>

      <details className="tw-more">
        <summary>
          {c.t("خيارات", "Options")}
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="tw-options">
          <label className="tw-switch">
            <input type="checkbox" checked={rain} onChange={(e) => setRain(e.target.checked)} />
            {c.t("أحداث مطر", "Rain events")}
          </label>
          <label>
            {c.t("عدد الأقسام", "Sections")}
            <select value={sections} onChange={(e) => setSections(Number(e.target.value))}>
              {[4, 6, 8, 10, 12].map((n) => (
                <option key={n} value={n}>
                  {c.num(n)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.t("بداية ساعات الري المسموحة", "Allowed hours from")}
            <select value={start} onChange={(e) => setStart(Number(e.target.value))} dir="ltr">
              {hours.map((h) => (
                <option key={h} value={h} disabled={h === end}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.t("نهايتها", "Until")}
            <select value={end} onChange={(e) => setEnd(Number(e.target.value))} dir="ltr">
              {hours.map((h) => (
                <option key={h} value={h} disabled={h === start}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.t("البذرة العشوائية", "Random seed")}
            <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} dir="ltr" />
          </label>
          <p className="tw-caption">
            {c.t(
              `الافتراضي ${hourLabel(DEFAULT_ALLOWED.start)}–${hourLabel(DEFAULT_ALLOWED.end)}. البذرة نفسها تعطي النتيجة نفسها.`,
              `Default ${hourLabel(DEFAULT_ALLOWED.start)}–${hourLabel(DEFAULT_ALLOWED.end)}. The same seed gives the same result.`,
            )}
          </p>
        </div>
      </details>

      <button
        type="button"
        className="tw-primary tw-start"
        onClick={() =>
          onStart({
            seed: Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : DEFAULT_SEED,
            days,
            season,
            rain,
            sections,
            allowedStart: start,
            allowedEnd: end,
            city,
          })
        }
      >
        <Play size={18} aria-hidden="true" />
        {c.t("ابدأ المحاكاة", "Start simulation")}
      </button>
    </section>
  );
}
