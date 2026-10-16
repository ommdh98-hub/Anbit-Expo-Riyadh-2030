"use client";
// Uses the app's language preference; API strings still pass through display().
import { usePreferences } from "../preferences-controls";
import { display } from "../../lib/i18n";
import { RIYADH_TZ } from "./constants";

// Shared by Home, Irrigation, Reports, Plants and the Digital Twin.
export const AR_LOCALE = "ar-SA-u-nu-latn";

export function useCopy() {
  const { language, theme } = usePreferences();
  const ar = language !== "en";
  // Arabic text with Western digits (0-9) in Arabic mode; ص/م and month names stay Arabic.
  const locale = ar ? AR_LOCALE : "en-US";
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const num = (n: number, digits = 0) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  const time = (ms: number | string) =>
    new Date(ms).toLocaleTimeString(locale, {
      timeZone: RIYADH_TZ,
      hour: "numeric",
      minute: "2-digit",
    });
  const day = (ms: number | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
    new Date(ms).toLocaleDateString(ar ? AR_LOCALE : "en-GB", { timeZone: RIYADH_TZ, ...opts });
  const ago = (value: number, unit: "minute" | "hour" | "day") =>
    new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-value, unit);
  const duration = (minutes: number | null) => {
    if (minutes == null) return "";
    if (minutes < 60) return t(`${num(minutes)} دقيقة`, `${num(minutes)} min`);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m
      ? t(`${num(h)} س ${num(m)} د`, `${num(h)} h ${num(m)} min`)
      : t(`${num(h)} ساعة`, `${num(h)} h`);
  };
  const litres = (n: number) =>
    n >= 10_000
      ? t(`${num(n / 1000, 1)} م³`, `${num(n / 1000, 1)} m³`)
      : t(`${num(n)} لتر`, `${num(n)} L`);
  const one = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
  // m² for irrigated areas; mm of water depth (1 L/m² = 1 mm); m³ with one decimal.
  const area = (m2: number | null | undefined) => (m2 == null ? "—" : t(`${num(m2)} م²`, `${num(m2)} m²`));
  const mm = (value: number) => t(`${num(value, 1)} مم`, `${num(value, 1)} mm`);
  const m3 = (litresValue: number) => {
    const text = Math.round(litresValue / 100) === 0 ? num(0) : one(litresValue / 1000);
    return t(`${text} م³`, `${text} m³`);
  };
  return { ar, language, theme, locale, t, num, time, day, ago, duration, litres, area, mm, m3, show: display };
}
export type Copy = ReturnType<typeof useCopy>;
