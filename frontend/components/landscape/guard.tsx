"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import BrandLogo from "../brand-logo";
import PreferencesControls from "../preferences-controls";
import { landscapeAccess } from "./data";
import { LandscapeProvider, type Profile } from "./context";
import { useCopy } from "./copy";
import { OrganicField } from "./visuals";

type Status = "checking" | "ready" | "anonymous" | "error";

// Reuses the existing session cookie. Sign-in itself stays on the main page.
export default function LandscapeGuard({ children }: { children: ReactNode }) {
  const c = useCopy();
  const [status, setStatus] = useState<Status>("checking");
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (r) => {
        if (r.status === 401) return setStatus("anonymous");
        if (!r.ok) return setStatus("error");
        setProfile((await r.json()) as Profile);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    const expired = () => setStatus("anonymous");
    window.addEventListener("anbit-session-expired", expired);
    return () => {
      controller.abort();
      window.removeEventListener("anbit-session-expired", expired);
    };
  }, []);
  const access = landscapeAccess(status, profile?.role);
  if (access === "allowed" && profile)
    return <LandscapeProvider profile={profile}>{children}</LandscapeProvider>;
  return (
    <main className="lx lx-gate" aria-busy={access === "checking"}>
      <OrganicField />
      <div className="lx-gate-card">
        <PreferencesControls />
        <BrandLogo variant="login" eager />
        {access === "checking" ? (
          <p role="status">{c.t("لحظة…", "One moment…")}</p>
        ) : (
          <>
            <h1>
              {access === "forbidden"
                ? c.t("هذه المساحة لفرق المسطحات الخضراء", "This space is for Landscape Teams")
                : status === "error"
                  ? c.t("تعذر الوصول إلى أنبت", "ANBIT is not reachable")
                  : c.t("سجّل الدخول للمتابعة", "Sign in to continue")}
            </h1>
            <p>
              {access === "forbidden"
                ? c.t("حسابك الحالي حساب أفراد. ارجع إلى الصفحة الرئيسية.", "You are signed in as an individual. Go back to the main page.")
                : c.t("ادخل بحساب فرق المسطحات الخضراء ثم ارجع إلى هنا.", "Sign in with the Landscape Teams account, then come back.")}
            </p>
            <Link className="lx-primary" href="/">
              {access === "forbidden" ? c.t("الصفحة الرئيسية", "Main page") : c.t("تسجيل الدخول", "Sign in")}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
