import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "./globals.css";
import "./reference-login.css";
import "./preferences.css";
import "./role-home.css";
import "./ux-refinement.css";
import "./planning.css";
import "./brand.css";
import "./growing-guide.css";
import "./report-print.css";
import { preferenceBootstrap } from "../lib/preferences.mjs";
export const metadata: Metadata = {
  applicationName: "أنبت | ANBIT",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: [
      { url: "/brand/icon-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  title: "أنبت | ANBIT",
  description:
    "أنبت | ANBIT — استكشاف النباتات وإدارة المسطحات الخضراء ودعم قرارات الري",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferenceBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
