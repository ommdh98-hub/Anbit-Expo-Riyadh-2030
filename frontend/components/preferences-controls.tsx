"use client";
import { Globe, Moon, Sun } from "lucide-react";
import { useSyncExternalStore, useEffect } from "react";
import {
  getPreferences,
  subscribePreferences,
  defaultPreferences,
  savePreferences,
} from "../lib/preferences.mjs";
export function usePreferences() {
  const snapshot = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
    () => defaultPreferences,
  );
  const [language, theme] = snapshot.split(":");
  return { language, theme };
}
export default function PreferencesControls() {
  const { language, theme } = usePreferences();
  useEffect(() => {
    if (language === document.documentElement.lang)
      delete document.documentElement.dataset.localizing;
  }, [language]);
  return (
    <div
      className="preference-controls"
      aria-label={
        language === "ar" ? "اللغة والمظهر" : "Language and appearance"
      }
    >
      <button
        type="button"
        className="icon-button"
        onClick={() => savePreferences(language === "ar" ? "en" : "ar", theme)}
        aria-label={
          language === "ar" ? "التبديل إلى الإنجليزية" : "Switch to Arabic"
        }
      >
        <Globe size={19} />
        <span>{language === "ar" ? "EN" : "عربي"}</span>
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() =>
          savePreferences(language, theme === "dark" ? "light" : "dark")
        }
        aria-label={
          language === "ar"
            ? theme === "dark"
              ? "الوضع الفاتح"
              : "الوضع الداكن"
            : theme === "dark"
              ? "Light mode"
              : "Dark mode"
        }
        aria-pressed={theme === "dark"}
      >
        {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
      </button>
    </div>
  );
}
