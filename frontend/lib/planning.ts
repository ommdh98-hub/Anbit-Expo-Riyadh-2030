export type Profile = {
  plant: string;
  soil: string;
  provenance: "demo_assumption" | "user_supplied";
  evidence: string;
  field_capacity: number;
  wilting_point: number;
  threshold: number;
  target: number;
  root_depth_m: number;
  area_m2: number;
  efficiency: number;
  flow_l_h: number | null;
};
export type ForecastPoint = {
  hour: number;
  at: string;
  vwc: number;
  low: number;
  high: number;
};
export type Plan = {
  kind: string;
  baseline_vwc: number;
  baseline_origin: string;
  profile: Profile;
  mode: string;
  forecast: ForecastPoint[];
  scheduled_forecast?: ForecastPoint[];
  estimate: { gross_l: number };
  duration_hours: number | null;
  crossing_hour: number | null;
  next_window_hour: number | null;
  blocked: string[];
  limitations: string[];
  schedule: {
    hour: number;
    at: string;
    volume_l: number;
    duration_hours: number | null;
    post_vwc: number;
    post_low: number;
    post_high: number;
  }[];
};
export type Research = {
  status: string;
  operational_eligible: boolean;
  evaluation: {
    treatment: string;
    horizon_h: number;
    model: string;
    n: number;
    mae_pp: number;
    rmse_pp: number;
    interval_half_width_pp: number;
    test_interval_coverage: number;
    mae_day_block_interval_95_pp: number[];
  }[];
  limitations?: string[];
};
export type Spatial = {
  method: string;
  measured: { x: number; y: number; vwc: number; origin: string }[];
  cells: {
    x: number;
    y: number;
    vwc: number | null;
    local_spread: number | null;
    nearest_m: number | null;
  }[];
  estimated_support_fraction: number;
  measured_coverage: number;
  next_point: { x: number; y: number; reason: string };
  reason: string;
};
export function theoreticalDuration(litres: number, flow: number | null) {
  return Number.isFinite(litres) &&
    litres >= 0 &&
    flow !== null &&
    Number.isFinite(flow) &&
    flow > 0
    ? litres / flow
    : null;
}
export function hypotheticalSavings(current: number, baseline: number | null) {
  return Number.isFinite(current) &&
    current >= 0 &&
    baseline !== null &&
    Number.isFinite(baseline) &&
    baseline > 0
    ? ((baseline - current) / baseline) * 100
    : null;
}
// Escape spreadsheet formula injection and quote every cell; BOM supports Arabic Excel.
export function csvText(rows: (string | number)[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value);
            if (/^[\s]*[=+@-]/.test(text) && typeof value === "string")
              text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
export function downloadCsv(rows: (string | number)[][]) {
  const url = URL.createObjectURL(
    new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "ANBIT-water-report.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
