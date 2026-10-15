import type { Metadata } from "next";
import LandscapeGuard from "../../components/landscape/guard";
import LandscapeShell from "../../components/landscape/shell";
import "../../components/landscape/landscape.css";

export const metadata: Metadata = { title: "أنبت | فرق المسطحات الخضراء" };

export default function LandscapeLayout({ children }: { children: React.ReactNode }) {
  return (
    <LandscapeGuard>
      <LandscapeShell>{children}</LandscapeShell>
    </LandscapeGuard>
  );
}
