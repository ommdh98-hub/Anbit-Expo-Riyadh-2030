"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { landscapeAccess, type Role } from "../landscape/data";
import { useCopy } from "../landscape/copy";

type Status = "checking" | "ready" | "anonymous" | "error";

// The only request /twin makes: a read-only session check. No operational endpoints.
export default function TwinGuard({ children }: { children: ReactNode }) {
  const c = useCopy();
  const [status, setStatus] = useState<Status>("checking");
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (r) => {
        if (r.status === 401) return setStatus("anonymous");
        if (!r.ok) return setStatus("error");
        setRole(((await r.json()) as { role: Role }).role);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, []);
  const access = landscapeAccess(status, role);
  if (access === "allowed") return <>{children}</>;
  return (
    <div className="tw-gate" aria-busy={access === "checking"}>
      {access === "checking" ? (
        <p role="status">{c.t("لحظة…", "One moment…")}</p>
      ) : (
        <div className="tw-card">
          <h1>
            {access === "forbidden"
              ? c.t("التوأم الرقمي لفرق المسطحات الخضراء", "The Digital Twin is for Landscape Teams")
              : c.t("سجّل الدخول للمتابعة", "Sign in to continue")}
          </h1>
          <Link className="tw-primary" href="/">
            {access === "forbidden" ? c.t("الصفحة الرئيسية", "Main page") : c.t("تسجيل الدخول", "Sign in")}
          </Link>
        </div>
      )}
    </div>
  );
}
