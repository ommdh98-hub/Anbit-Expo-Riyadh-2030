"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUpLeft, RefreshCw } from "lucide-react";
import BrandLogo from "./brand-logo";
import { Garden } from "./login-garden";
import PreferencesControls, { usePreferences } from "./preferences-controls";
import { display } from "../lib/i18n";
import Workspace from "./workspace";
import { api, post } from "../lib/api";

export type AnbitProfile = {
  username: "user" | "survey";
  name: string;
  role: "user" | "survey";
};

async function restoreSession(
  signal: AbortSignal,
): Promise<AnbitProfile | null> {
  const response = await fetch("/api/auth/me", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("تعذر الوصول للخادم. تحقق من تشغيل أنبت.");
  return response.json() as Promise<AnbitProfile>;
}

export default function AuthGate() {
  const { language } = usePreferences();
  const t = (ar: string, en: string) => (language === "ar" ? ar : en);
  const [profile, setProfile] = useState<AnbitProfile | null>(null);
  const [status, setStatus] = useState<
    "checking" | "login" | "ready" | "error"
  >("checking");
  const [role, setRole] = useState<"user" | "survey">("user");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const sessionCheck = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    sessionCheck.current = controller;
    void restoreSession(controller.signal)
      .then((restored) => {
        if (controller.signal.aborted) return;
        setProfile(restored);
        setStatus(restored ? "ready" : "login");
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "تعذر الاتصال بالخادم");
        setStatus("error");
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    const expired = () => {
      sessionCheck.current?.abort();
      setProfile(null);
      setPassword("");
      setStatus("login");
      setError("انتهت الجلسة. سجّل الدخول مرة أخرى.");
    };
    window.addEventListener("anbit-session-expired", expired);
    return () => window.removeEventListener("anbit-session-expired", expired);
  }, []);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    sessionCheck.current?.abort();
    setBusy(true);
    setError("");
    try {
      const user = await api<AnbitProfile>(
        "/auth/login",
        post({ username: role, password }),
      );
      setProfile(user);
      setPassword("");
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    sessionCheck.current?.abort();
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* Sign out in this browser even when the server is unreachable. */
    }
    setProfile(null);
    setPassword("");
    setStatus("login");
    setError("");
  }
  if (status === "ready" && profile)
    return <Workspace profile={profile} onLogout={logout} />;
  return (
    <main className="reference-login">
      <div className="reference-login-visual">
        <div className="reference-brand">
          <BrandLogo variant="login" eager />
        </div>
        <h1>{t("كل قطرة، حياة.", "Every drop. More life.")}</h1>
        <p>
          {t(
            "حديقة تنمو. مياه تُحفظ. وراحة بال.",
            "A growing garden. Water saved. Peace of mind.",
          )}
        </p>
        <Garden
          watering
          label={t("رسم حديقة أنبت", "ANBIT garden illustration")}
        />
        <span className="reference-pill">
          {t(
            "تجربة تفاعلية • لا تحتاج معدات",
            "Interactive demo • no equipment needed",
          )}
        </span>
      </div>
      <section
        className="reference-login-form"
        aria-label={t("تسجيل الدخول إلى أنبت", "Sign in to ANBIT")}
      >
        <PreferencesControls />
        <span className="reference-eyebrow">WELCOME TO ANBIT</span>
        <h2>{t("أهلاً بحديقتك 🌿", "Welcome to your garden 🌿")}</h2>
        <p>
          {t("دع أنبت يعتني بالتفاصيل.", "Let ANBIT take care of the details.")}
        </p>
        {status === "checking" && (
          <p role="status">{t("جار التحقق من الجلسة…", "Checking session…")}</p>
        )}
        {status === "error" && (
          <div className="reference-error">
            <p role="alert">{display(error)}</p>
            <button
              type="button"
              onClick={() => {
                setStatus("checking");
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              <RefreshCw size={16} />
              {t("إعادة المحاولة", "Retry")}
            </button>
          </div>
        )}
        {status === "login" && (
          <>
            <div
              className="reference-segments"
              role="group"
              aria-label={t("نوع الحساب", "Account role")}
            >
              <button
                type="button"
                className={role === "user" ? "selected" : ""}
                aria-pressed={role === "user"}
                onClick={() => {
                  setRole("user");
                  setError("");
                }}
              >
                {t("الأفراد", "Individuals")}
              </button>
              <button
                type="button"
                className={role === "survey" ? "selected" : ""}
                aria-pressed={role === "survey"}
                onClick={() => {
                  setRole("survey");
                  setError("");
                }}
              >
                {t("فرق المسطحات الخضراء", "Landscape Teams")}
              </button>
            </div>
            <small className="reference-role-description">
              {role === "user"
                ? t(
                    "اختر نباتًا لمدينتك واستكشف معلومات الزراعة والعناية المتاحة",
                    "Choose plants for your city and explore available growing and care information",
                  )
                : t(
                    "استكشف النباتات وأدر القياسات والتوصيات والري والتقارير",
                    "Explore plants and manage measurements, recommendations, irrigation and reports",
                  )}
            </small>
            <form onSubmit={login}>
              <label>
                {t("اسم المستخدم", "Username")}
                <input
                  type="text"
                  value={role}
                  readOnly
                  autoComplete="username"
                  dir="ltr"
                />
              </label>
              <label htmlFor="anbit-password">
                {t("كلمة المرور", "Password")}
                <input
                  id="anbit-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={1}
                  maxLength={128}
                  dir="ltr"
                  onInvalid={(e) =>
                    e.currentTarget.setCustomValidity(
                      t(
                        "أدخل كلمة المرور للمتابعة.",
                        "Enter your password to continue.",
                      ),
                    )
                  }
                  onInput={(e) => e.currentTarget.setCustomValidity("")}
                />
              </label>
              {error && (
                <div role="alert" className="reference-error">
                  {display(error)}
                </div>
              )}
              <button className="primary" disabled={busy} type="submit">
                {busy
                  ? t("لحظة…", "One moment…")
                  : t("دخول إلى أنبت", "Sign in to ANBIT")}
                <ArrowUpLeft size={18} />
              </button>
            </form>
            <p className="reference-login-note">
              {t(
                "حسابات محلية للتجربة. بيانات الموقع وعمليات الري محاكاة، دون أجهزة متصلة.",
                "Local prototype accounts. Site data and irrigation events are simulated, with no connected devices.",
              )}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
