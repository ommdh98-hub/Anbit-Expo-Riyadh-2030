"use client";
// Uses the app's language preference; API strings still pass through display().
import { usePreferences } from "../preferences-controls";
import { display } from "../../lib/i18n";
import { RIYADH_TZ } from "./constants";

export function useCopy() {
  const { language, theme } = usePreferences();
  const ar = language !== "en";
  const locale = ar ? "ar-SA" : "en-US";
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const num = (n: number, digits = 0) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  const time = (ms: number | string) =>
    new Date(ms).toLocaleTimeString(ar ? "ar-SA" : "en-US", {
      timeZone: RIYADH_TZ,
      hour: "numeric",
      minute: "2-digit",
    });
  const day = (ms: number | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
    new Date(ms).toLocaleDateString(ar ? "ar-SA" : "en-GB", { timeZone: RIYADH_TZ, ...opts });
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
  return { ar, language, theme, t, num, time, day, ago, duration, litres, show: display };
}
export type Copy = ReturnType<typeof useCopy>;
