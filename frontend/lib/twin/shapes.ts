// Soft organic outlines for the abstract garden map. Deterministic per section.
import { rng } from "./engine";

export const MAP = { width: 400, height: 300, cols: 4, rows: 3 } as const;

export type Blob = { id: string; cx: number; cy: number; d: string };

function smoothPath(points: [number, number][]) {
  // Closed Catmull-Rom spline converted to cubic Béziers.
  const n = points.length;
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

export function blobs(ids: string[], seed = 7): Blob[] {
  const r = rng(seed);
  const cw = MAP.width / MAP.cols;
  const ch = MAP.height / MAP.rows;
  return ids.map((id, i) => {
    const col = i % MAP.cols;
    const row = Math.floor(i / MAP.cols);
    const cx = cw * (col + 0.5) + (r() - 0.5) * 12;
    const cy = ch * (row + 0.5) + (r() - 0.5) * 10;
    const rx = cw * (0.36 + r() * 0.06);
    const ry = ch * (0.33 + r() * 0.06);
    const k = 9;
    const turn = r() * Math.PI;
    const pts: [number, number][] = Array.from({ length: k }, (_, j) => {
      const a = turn + (j / k) * Math.PI * 2;
      const wobble = 0.82 + r() * 0.3;
      return [cx + Math.cos(a) * rx * wobble, cy + Math.sin(a) * ry * wobble];
    });
    return { id, cx, cy, d: smoothPath(pts) };
  });
}
