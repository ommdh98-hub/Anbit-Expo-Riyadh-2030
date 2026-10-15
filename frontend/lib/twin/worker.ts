/// <reference lib="webworker" />
// Runs the twin off the main thread and streams snapshots for animation.
import { STEP_MINUTES } from "./constants";
import { createSim, predictNext, results, snapshot, step, timeAt, type SimConfig, type SimState } from "./engine";
import { predictNeed, toSensorIndex } from "./model";

export type ToWorker =
  | { type: "start"; config: SimConfig; speed: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "speed"; speed: number }
  | { type: "skip" }
  | { type: "inspect"; index: number };

const TICK_MS = 100;
const STEP_SECONDS = STEP_MINUTES * 60;
const MAX_STEPS_PER_TICK = 400;

let state: SimState | null = null;
let speed = 60;
let playing = false;
let carry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const post = (message: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

function publish() {
  if (!state) return;
  const snap = snapshot(state);
  // Smooth clock between 15-minute steps.
  post({ type: "snapshot", snapshot: { ...snap, timeMs: snap.done ? snap.timeMs : snap.timeMs + carry * 1000 } });
  if (snap.done) {
    playing = false;
    post({ type: "results", results: results(state) });
  }
}

function tick() {
  timer = null;
  if (!state || !playing) return;
  carry += (speed * TICK_MS) / 1000;
  let n = Math.floor(carry / STEP_SECONDS);
  carry -= n * STEP_SECONDS;
  n = Math.min(n, MAX_STEPS_PER_TICK);
  while (n-- > 0 && step(state));
  publish();
  if (playing) timer = setTimeout(tick, TICK_MS);
}

function skip() {
  if (!state) return;
  playing = false;
  // Chunks keep progress visible and the worker responsive to new messages.
  const chunk = () => {
    if (!state) return;
    for (let k = 0; k < 600 && step(state); k++);
    carry = 0;
    publish();
    if (state.i < state.total) setTimeout(chunk, 0);
  };
  chunk();
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const m = event.data;
  if (m.type === "start") {
    state = createSim(m.config);
    speed = m.speed;
    carry = 0;
    playing = true;
    publish();
    if (!timer) timer = setTimeout(tick, TICK_MS);
  } else if (m.type === "pause") {
    playing = false;
    publish();
  } else if (m.type === "resume") {
    if (!state || state.i >= state.total) return;
    playing = true;
    if (!timer) timer = setTimeout(tick, TICK_MS);
  } else if (m.type === "speed") speed = m.speed;
  else if (m.type === "skip") skip();
  else if (m.type === "inspect" && state) {
    const s = state.sections[m.index];
    if (!s) return;
    const i = Math.min(state.i, state.total - 1);
    const w = state.weather[i];
    const est = state.est[m.index];
    const need = predictNeed([toSensorIndex(est, s.wp, s.fc), w.tempC, w.rh, w.light, w.rainMm > 0 ? 1 : 0]);
    const curve = state.curves[m.index];
    post({
      type: "section",
      section: {
        index: m.index,
        spec: s,
        est,
        m: state.anbit[m.index].m,
        valve: state.anbit[m.index].valve,
        next: predictNext(state, m.index),
        modelNeed: need,
        curve: curve.map((v, k) => ({ t: timeAt(state!, state!.i - curve.length + k + 1), vwc: v })),
      },
    });
  }
};
