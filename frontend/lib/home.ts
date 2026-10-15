import type { Profile } from "./planning";

export type HomeSettings = {
  profile?: Profile | null;
  weather?: {
    kind: string;
    et_mm_day: number;
    rain_mm: number;
    rain_hour: number;
    uncertainty_vwc: number;
  } | null;
  allowed_start_hour?: number;
  allowed_end_hour?: number;
};
export type HomeSummary = {
  current_vwc: number | null;
  source: "measured" | "estimated" | "simulation" | null;
  origin: string;
  stale: boolean;
  age_hours: number | null;
  target_vwc: number | null;
  profile: Profile | null;
  demo_profile: boolean;
  gross_l: number | null;
  area_m2: number | null;
  duration_hours: number | null;
  flow_l_h: number;
  default_flow: boolean;
  default_weather: boolean;
  weather: NonNullable<HomeSettings["weather"]>;
  next_at: string | null;
  duration_fits_window?: boolean;
  can_review: boolean;
  needs_reading: boolean;
  limitations: string[];
};
export function subscribeHomeProfile(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("anbit-profile", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("anbit-profile", listener);
  };
}
export function homeProfile(id: string) {
  try {
    return localStorage.getItem(`anbit-planning-profile-v1:${id}`) ?? "";
  } catch {
    return "";
  }
}
