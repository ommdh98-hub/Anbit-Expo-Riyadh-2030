// Browser inference for the decision trees exported by
// research/simulation/train_sim_model.py. Trained on synthetic data only.
import model from "./model.json";

export type TreeNode = { f: number; t: number; l: TreeNode; r: TreeNode } | { p?: number; v?: number; n: number };
export type TwinModel = {
  features: string[];
  feature_ranges: Record<string, [number, number]>;
  soil_moisture_index: { min: number; max: number };
  classifier: TreeNode;
  regressor_minutes: TreeNode;
  regressor_has_signal: boolean;
  metrics: { classifier_accuracy: number; rule_accuracy: number; minutes_r2: number };
  samples: { x: number[]; need_p: number; minutes: number }[];
};
export const TWIN_MODEL = model as unknown as TwinModel;

export function evaluate(node: TreeNode, x: number[]): number {
  let n = node;
  while ("f" in n) n = x[n.f] <= n.t ? n.l : n.r;
  return (n.p ?? n.v) as number;
}

// Sensor index assumption: 10 = wilting point, 90 = field capacity, linear.
export function toSensorIndex(vwc: number, wp: number, fc: number, m: TwinModel = TWIN_MODEL) {
  const { min, max } = m.soil_moisture_index;
  const rel = (vwc - wp) / (fc - wp);
  return Math.max(min, Math.min(max, min + rel * (max - min)));
}

export function inTrainingRange(x: number[], m: TwinModel = TWIN_MODEL) {
  return m.features.every((f, i) => {
    const [lo, hi] = m.feature_ranges[f];
    return x[i] >= lo && x[i] <= hi;
  });
}

// Need probability, or null when the inputs leave the range the trees were trained on.
export function predictNeed(x: number[], m: TwinModel = TWIN_MODEL): number | null {
  return inTrainingRange(x, m) ? evaluate(m.classifier, x) : null;
}
