export type Point = { id: string; name: string; x: number; y: number };
export type Reading = {
  id: string;
  point_id: string;
  value: number;
  unit: string;
  measured_at: string;
  source: string;
  operator: string;
  quality: string;
  origin: string;
};
export type Coverage = {
  fraction: number;
  active_points: number;
  total_points: number;
  radius_m: number;
  required_fraction: number;
  uncovered_cells: { x: number; y: number }[];
  next_point: { x: number; y: number; distance_m: number; reason: string };
  method: string;
  caveat: string;
};
export type Estimate = {
  net_l: number;
  gross_l: number;
  deficit_fraction: number;
  area_m2: number;
  root_depth_m: number;
  efficiency: number;
  label: string;
  formula: string;
};
export type Decision = {
  code: string;
  label: string;
  reason: string;
  rules: string[];
  missing: string[];
  readings_used: string[];
  rejected: { id: string; reason: string }[];
  sources: string[];
  mean_vwc: number | null;
  coverage: Coverage;
  estimate: Estimate | null;
  validity: string;
  caveats: string[];
  inspection_priority: number;
  evaluated_at: string;
};
export type Zone = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  area_m2: number;
  irrigated_area_m2: number;
  root_depth_m: number;
  efficiency: number;
  origin: string;
  method: string;
  revision: number;
  plant: { name: string };
  soil: {
    name: string;
    lower_vwc: number;
    target_vwc: number;
    upper_vwc: number;
  };
  points: Point[];
  measurements: Reading[];
  decision: Decision;
};
export type Recommendation = {
  id: string;
  zone_id: string;
  status: string;
  created_at: string;
  revision: number;
  result: Decision;
};
export type WaterEvent = {
  id: string;
  zone_id: string;
  volume_l: number;
  volume_kind: string;
  executed_at: string;
  operator: string;
};
export type Report = {
  total_l: number;
  events_count: number;
  measured_l: number;
  estimated_l: number;
  by_zone: {
    id: string;
    name: string;
    litres: number;
    litres_per_m2: number;
    events: number;
  }[];
  daily: { date: string; litres: number }[];
  events: WaterEvent[];
  limitations: string;
};
export type Plant = {
  id: string;
  name: string;
  scientific_name: string | null;
  notes: string;
  source: { title: string; description: string };
};
export type Inspection = {
  id: string;
  notes: string;
  operator: string;
  created_at: string;
};
