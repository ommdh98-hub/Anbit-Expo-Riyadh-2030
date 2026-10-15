"use client";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Droplets, MapPin, SlidersHorizontal } from "lucide-react";
import { currentLanguage, display as t } from "../lib/i18n";
import { api, number, post } from "../lib/api";
import type { Zone } from "../lib/types";
import type { HomeSettings, HomeSummary } from "../lib/home";
import { homeProfile, subscribeHomeProfile } from "../lib/home";
import { suggestedMeasurement } from "../lib/role-home";
import { simpleState } from "./guided-evaluation";
import PredictivePlanner from "./predictive-planner";

function Badge({ children }: { children: ReactNode }) {
  return <span className="home-badge">{children}</span>;
}
function freshness(hours: number) {
  const language = currentLanguage() === "ar" ? "ar" : "en";
  const unit = hours < 1 ? "minute" : hours >= 24 ? "day" : "hour";
  const value = Math.floor(
    hours < 1 ? hours * 60 : hours >= 24 ? hours / 24 : hours,
  );
  return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(
    -value,
    unit,
  );
}
export function HomeCards({
  summary: s,
  onTarget,
  loading = false,
}: {
  summary: HomeSummary | null;
  onTarget: () => void;
  loading?: boolean;
}) {
  const absent = t(loading ? "جار الحساب…" : "أدخل قراءة");
  const moisture =
    s?.current_vwc == null ? absent : `${number(s.current_vwc * 100)}%`;
  const source = {
    measured: "مقاسة",
    estimated: "تقدير",
    simulation: "محاكاة",
  };
  return (
    <div className="home-four-cards" aria-busy={loading}>
      <article data-home-card="moisture">
        <h2>{t("رطوبة التربة الحالية")}</h2>
        <strong
          className={
            s?.current_vwc == null
              ? "home-value home-action-state"
              : "home-value"
          }
        >
          {moisture}
        </strong>
        <div className="home-badges">
          {s?.source && (
            <Badge>
              {s.source === "estimated" && currentLanguage() === "en"
                ? "Estimated"
                : t(source[s.source])}
            </Badge>
          )}
          {s?.stale && <Badge>{t("تقدير سيناريو")}</Badge>}
          {s?.age_hours != null && <Badge>{freshness(s.age_hours)}</Badge>}
        </div>
      </article>
      <article data-home-card="target">
        <h2>{t("الرطوبة المستهدفة")}</h2>
        {s?.target_vwc == null ? (
          <button
            className="home-value home-action-state home-set-target"
            disabled={loading}
            onClick={onTarget}
          >
            {t(loading ? "جار الحساب…" : "حدد الهدف")}
          </button>
        ) : (
          <strong className="home-value">{number(s.target_vwc * 100)}%</strong>
        )}
        <div className="home-badges">
          {s?.target_vwc != null && (
            <Badge>{t(s.demo_profile ? "افتراض عرض" : "إعداد مستخدم")}</Badge>
          )}
        </div>
      </article>
      <article data-home-card="water">
        <h2>
          {currentLanguage() === "en" ? "Water needed" : t("الاحتياج المائي")}
        </h2>
        <strong
          className={
            s?.gross_l == null ? "home-value home-action-state" : "home-value"
          }
        >
          {s?.gross_l == null ? (
            absent
          ) : (
            <>
              {number(s.gross_l)} <span>{t("لتر")}</span>
            </>
          )}
        </strong>
        {s?.gross_l != null && (
          <p className="home-card-support">
            {number(s.area_m2!)} {t("م²")} · ≈ {number(s.duration_hours!)}{" "}
            {t("ساعة")}
          </p>
        )}
        <div className="home-badges">
          {s?.gross_l != null && <Badge>{t("تقدير سيناريو")}</Badge>}
          {s?.gross_l != null && s.default_flow && (
            <Badge>{t("تدفق افتراضي")}</Badge>
          )}
          {s?.next_at && s.duration_fits_window === false && (
            <Badge>{t("راجع التدفق")}</Badge>
          )}
        </div>
      </article>
      <article data-home-card="next">
        <h2>{t("موعد الري القادم")}</h2>
        <strong
          className={s?.next_at ? "home-value" : "home-value home-action-state"}
        >
          {s?.next_at
            ? new Intl.DateTimeFormat(
                currentLanguage() === "ar" ? "ar-SA" : "en-GB",
                { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" },
              ).format(new Date(s.next_at))
            : t(
                loading
                  ? "جار الحساب…"
                  : s?.current_vwc == null
                    ? "أدخل قراءة"
                    : "راجع السيناريو",
              )}
        </strong>
        <div className="home-badges">
          {s?.next_at && (
            <>
              <Badge>{t("تقدير سيناريو")}</Badge>
              <Badge>
                {new Intl.DateTimeFormat(
                  currentLanguage() === "ar" ? "ar-SA" : "en-GB",
                  { weekday: "short", timeZone: "Asia/Riyadh" },
                ).format(new Date(s.next_at))}
              </Badge>
            </>
          )}
        </div>
      </article>
    </div>
  );
}

export default function LandscapeHome({
  zones,
  zone,
  busy,
  onSelect,
  onReading,
  onReview,
  onMap,
  onDecisions,
  children,
}: {
  zones: Zone[];
  zone: Zone;
  busy: boolean;
  onSelect: (id: string) => void;
  onReading: () => void;
  onReview: () => void;
  onMap: () => void;
  onDecisions: () => void;
  children: ReactNode;
}) {
  const profileSnapshot = useSyncExternalStore(
    subscribeHomeProfile,
    () => homeProfile(zone.id),
    () => "",
  );
  const [settings, setSettings] = useState<HomeSettings>({});
  const [response, setResponse] = useState<{
    key: string;
    value?: HomeSummary;
    error?: string;
  } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const advancedRef = useRef<HTMLDetailsElement>(null);
  let profile = null;
  try {
    profile = JSON.parse(profileSnapshot || "null");
  } catch {
    /* Invalid browser settings are not measurements. */
  }
  const body = JSON.stringify({ ...settings, profile });
  const requestKey = `${zone.id}:${zone.revision}:${zone.decision.evaluated_at}:${body}`;
  const summary =
    response?.key === requestKey ? (response.value ?? null) : null;
  const error = response?.key === requestKey ? response.error : null;
  const loading = response?.key !== requestKey;
  useEffect(() => {
    const controller = new AbortController();
    api<HomeSummary>(`/zones/${zone.id}/home`, {
      ...post(JSON.parse(body)),
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setResponse({ key: requestKey, value });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setResponse({
            key: requestKey,
            error: e instanceof Error ? e.message : "راجع إعدادات السيناريو",
          });
      });
    return () => controller.abort();
  }, [zone.id, requestKey, body]);
  function openTarget() {
    setAdvanced(true);
    if (advancedRef.current) advancedRef.current.open = true;
    requestAnimationFrame(() => {
      const configuration =
        advancedRef.current?.querySelector<HTMLDetailsElement>(
          ".planning-config",
        );
      if (configuration) configuration.open = true;
      const input = configuration?.querySelector<HTMLInputElement>(
        'input[name="target"]',
      );
      input?.focus();
      input?.scrollIntoView({ block: "center", behavior: "auto" });
    });
  }
  const review = !!summary?.can_review && !summary.needs_reading;
  return (
    <section
      className="landscape-home"
      aria-label={t("إدارة المسطحات الخضراء")}
    >
      <div className="home-zone-picker">
        <div className="home-zone-heading">
          <label htmlFor="home-zone">{t("اختر المنطقة")}</label>
          <Badge>{t(simpleState(zone).title)}</Badge>
        </div>
        <select
          id="home-zone"
          value={zone.id}
          disabled={busy}
          onChange={(e) => onSelect(e.target.value)}
        >
          {zones.map((item) => (
            <option key={item.id} value={item.id}>
              {t(item.name)}
            </option>
          ))}
        </select>
      </div>
      <HomeCards summary={summary} loading={loading} onTarget={openTarget} />
      <div className="home-primary-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={review ? onReview : onReading}
        >
          <Droplets size={20} />
          {t(review ? "مراجعة الري" : "تسجيل قراءة")}
        </button>
        <button
          className="text-button home-map-action"
          disabled={!suggestedMeasurement(zone) || busy}
          onClick={onMap}
        >
          <MapPin size={17} />
          {t("أين أقيس؟")}
        </button>
      </div>
      {error && (
        <p className="home-inline-error" role="alert">
          <button onClick={openTarget}>{t("راجع إعدادات السيناريو")}</button>
        </p>
      )}
      <details
        className="home-advanced"
        ref={advancedRef}
        open={advanced}
        onToggle={(e) => setAdvanced(e.currentTarget.open)}
      >
        <summary>
          <SlidersHorizontal size={18} />
          {t("تفاصيل متقدمة")}
        </summary>
        {advanced && (
          <div className="home-advanced-content">
            <section className="home-assumptions">
              <h2>{t("الافتراضات والحدود")}</h2>
              <ul>
                {(
                  summary?.limitations ?? [
                    "تقديرات الرئيسية سيناريو فقط؛ لا تعتمد الري ولا تسجله ولا تشغّل أجهزة.",
                  ]
                ).map((text) => (
                  <li key={text}>{t(text)}</li>
                ))}
              </ul>
              <p>{t("شارة العمر تخص أقدم قراءة مستخدمة، لا قياسًا جديدًا.")}</p>
              <p>
                {t(
                  "الوقت بتوقيت الرياض؛ الموعد بداية نافذة سيناريو، وليس أمر تشغيل أو ضمان اكتمال المدة داخل النافذة.",
                )}
              </p>
              {error && <p role="alert">{t(error)}</p>}
            </section>
            {children}
            <PredictivePlanner
              zone={zone}
              initialProfile={
                summary?.profile
                  ? {
                      ...summary.profile,
                      plant: profile ? summary.profile.plant : zone.plant.name,
                    }
                  : undefined
              }
              initialWeather={summary?.weather}
              onDecisions={onDecisions}
              onConfigured={(value) =>
                setSettings({
                  weather: value.weather,
                  allowed_start_hour: value.allowed_start_hour,
                  allowed_end_hour: value.allowed_end_hour,
                })
              }
            />
          </div>
        )}
      </details>
    </section>
  );
}
