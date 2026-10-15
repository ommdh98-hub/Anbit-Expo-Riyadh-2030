"use client";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Globe, Moon, Sun } from "lucide-react";
import { savePreferences } from "../../lib/preferences.mjs";
import { useCopy, type Copy } from "../landscape/copy";
import type { PlantKind, SoilKind } from "../../lib/twin/constants";

// The twin keeps its own theme (dark by default); language follows the app.
const THEME_KEY = "anbit-twin-theme";
const listeners = new Set<() => void>();
function readTheme(): "dark" | "light" {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
export function useTwinTheme() {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readTheme,
    () => "dark" as const,
  );
  const toggle = () => {
    try {
      localStorage.setItem(THEME_KEY, theme === "dark" ? "light" : "dark");
    } catch {
      /* Storage is optional. */
    }
    listeners.forEach((l) => l());
  };
  return { theme, toggle };
}

export function TwinFrame({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTwinTheme();
  const c = useCopy();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    // Same as the app's preferences control: reveal the page once the language matches.
    if (c.language === document.documentElement.lang) delete document.documentElement.dataset.localizing;
  }, [c.language]);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className={`tw ${entered ? "tw-entered" : ""}`} data-twin-theme={theme}>
      <header className="tw-top">
        <Link href="/landscape" className="tw-icon-link" aria-label={c.t("العودة إلى فرق المسطحات", "Back to Landscape Teams")}>
          <ArrowRight size={20} aria-hidden="true" className="tw-back" />
        </Link>
        <div className="tw-title">
          <strong>{c.t("التوأم الرقمي", "Digital Twin")}</strong>
          <span className="tw-sim-badge" role="note">
            <i aria-hidden="true" />
            {c.t("محاكاة — لا تؤثر على بيانات التشغيل", "Simulation — does not affect operational data")}
          </span>
        </div>
        <div className="tw-tools">
          <button type="button" className="tw-icon" onClick={() => savePreferences(c.ar ? "en" : "ar", c.theme)} aria-label={c.t("التبديل إلى الإنجليزية", "Switch to Arabic")}>
            <Globe size={18} aria-hidden="true" />
            <span>{c.ar ? "EN" : "عربي"}</span>
          </button>
          <button type="button" className="tw-icon" onClick={toggle} aria-pressed={theme === "dark"} aria-label={theme === "dark" ? c.t("الوضع الفاتح", "Light mode") : c.t("الوضع الداكن", "Dark mode")}>
            {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}

export const plantName = (c: Copy, p: PlantKind) =>
  ({
    turf: c.t("نجيل", "Turfgrass"),
    palm: c.t("نخيل", "Date palm"),
    olive: c.t("زيتون", "Olive"),
    shrub: c.t("شجيرات", "Shrubs"),
    bougainvillea: c.t("جهنمية", "Bougainvillea"),
    flowers: c.t("زهور موسمية", "Seasonal flowers"),
  })[p];
export const soilName = (c: Copy, s: SoilKind) =>
  ({ sandy: c.t("رملية", "Sandy"), loam: c.t("طميية", "Loam"), clay: c.t("طينية", "Clay") })[s];
export const sensorName = (c: Copy, lora: boolean) => (lora ? "LoRa" : c.t("افتراضي", "Virtual"));
export const pct = (c: Copy, fraction: number, digits = 0) => `${c.num(fraction * 100, digits)}%`;
export const signedSaving = (c: Copy, saving: number | null) =>
  saving == null ? "—" : `${saving < 0 ? "−" : ""}${c.num(Math.abs(saving))}%`;
