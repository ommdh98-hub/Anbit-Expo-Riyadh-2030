// Allowed irrigation window, shared by the Digital Twin, Home and Irrigation.
// Hours are local (Asia/Riyadh); the window may cross midnight (e.g. 18 → 8).
// backend/app/window.py implements the same rules; both are checked against
// frontend/tests/fixtures/irrigation-windows.json.

export function inWindow(hour: number, start: number, end: number) {
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
// Hours from `hour` until the current allowed window closes (0 outside it).
export function hoursToWindowEnd(hour: number, start: number, end: number) {
  if (!inWindow(hour, start, end)) return 0;
  return (end - hour + 24) % 24 || 24;
}
export const windowLength = (start: number, end: number) => (end - start + 24) % 24 || 24;
