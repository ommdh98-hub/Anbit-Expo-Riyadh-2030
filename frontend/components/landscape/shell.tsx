"use client";
import { useState, type ReactNode, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChartColumn, Droplets, House, LogOut, Orbit, Sprout } from "lucide-react";
import BrandLogo from "../brand-logo";
import PreferencesControls from "../preferences-controls";
import { api } from "../../lib/api";
import { useCopy } from "./copy";

export const NAV = [
  { href: "/landscape", ar: "الرئيسية", en: "Home", icon: House },
  { href: "/landscape/irrigation", ar: "قرارات الري", en: "Irrigation", icon: Droplets },
  { href: "/landscape/reports", ar: "التقارير", en: "Reports", icon: ChartColumn },
  { href: "/landscape/plants", ar: "النباتات والمدن", en: "Plants & Cities", icon: Sprout },
  { href: "/twin", ar: "التوأم الرقمي", en: "Digital Twin", icon: Orbit },
] as const;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function LandscapeShell({ children }: { children: ReactNode }) {
  const c = useCopy();
  const path = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  // The Twin is a separate experience; this module only owns the hand-off.
  function openTwin(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (reducedMotion()) return router.push("/twin");
    setLeaving(true);
    window.setTimeout(() => router.push("/twin"), 520);
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* Sign out locally even when the server is unreachable. */
    }
    router.replace("/");
  }
  const items = NAV.map((item) => {
    const Icon = item.icon;
    const active = item.href === "/landscape" ? path === "/landscape" : path?.startsWith(item.href);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={active ? "active" : ""}
          onClick={item.href === "/twin" ? openTwin : undefined}
          prefetch={item.href !== "/twin"}
        >
          <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
          <span>{c.t(item.ar, item.en)}</span>
        </Link>
      </li>
    );
  });
  return (
    <div className="lx lx-shell">
      <a className="lx-skip" href="#lx-main">
        {c.t("انتقل إلى المحتوى", "Skip to content")}
      </a>
      <aside className="lx-side">
        <div className="lx-side-logo">
          <BrandLogo variant="sidebar" eager />
        </div>
        <nav aria-label={c.t("التنقل الرئيسي", "Main navigation")}>
          <ul>{items}</ul>
        </nav>
        <div className="lx-side-foot">
          <PreferencesControls />
          <button type="button" className="lx-quiet" onClick={logout}>
            <LogOut size={18} aria-hidden="true" />
            {c.t("خروج", "Sign out")}
          </button>
        </div>
      </aside>
      <div className="lx-topbar">
        <BrandLogo variant="navigation" eager />
        <div className="lx-topbar-tools">
          <PreferencesControls />
          <button type="button" className="lx-icon" onClick={logout} aria-label={c.t("خروج", "Sign out")}>
            <LogOut size={18} />
          </button>
        </div>
      </div>
      <main id="lx-main" className="lx-main" tabIndex={-1}>
        {children}
      </main>
      <nav className="lx-bottom" aria-label={c.t("التنقل الرئيسي", "Main navigation")}>
        <ul>{items}</ul>
      </nav>
      {leaving && (
        <div className="lx-twin-veil" role="status">
          <span>{c.t("التوأم الرقمي", "Digital Twin")}</span>
        </div>
      )}
    </div>
  );
}

export function ScreenHeader({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <header className="lx-head">
      <div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {children}
    </header>
  );
}
