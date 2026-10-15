import type { Metadata } from "next";
import { TwinFrame } from "../../components/twin/chrome";
import TwinGuard from "../../components/twin/guard";
import "../../components/twin/twin.css";

export const metadata: Metadata = { title: "أنبت | التوأم الرقمي" };

export default function TwinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TwinFrame>
      <TwinGuard>{children}</TwinGuard>
    </TwinFrame>
  );
}
