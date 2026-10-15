"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Results, Section, SimConfig, Snapshot } from "../../lib/twin/engine";
import { SPEEDS, type SpeedId } from "../../lib/twin/constants";
import type { ToWorker } from "../../lib/twin/worker";

export type SectionDetail = {
  index: number;
  spec: Section;
  est: number;
  m: number;
  valve: boolean;
  next: number | null;
  modelNeed: number | null;
  curve: { t: number; vwc: number }[];
};
type FromWorker =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "results"; results: Results }
  | { type: "section"; section: SectionDetail };

// Owns the Web Worker; the UI only ever receives snapshots.
export function useTwinSim() {
  const worker = useRef<Worker | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [res, setRes] = useState<Results | null>(null);
  const [detail, setDetail] = useState<SectionDetail | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedId] = useState<SpeedId>("60x");
  const send = useCallback((m: ToWorker) => worker.current?.postMessage(m), []);
  // Stable so effects that poll a section are not reset by every snapshot.
  const inspect = useCallback((index: number) => send({ type: "inspect", index }), [send]);
  const secondsFor = (id: SpeedId) => SPEEDS.find((s) => s.id === id)!.simSecondsPerSecond;

  useEffect(() => () => worker.current?.terminate(), []);

  const start = useCallback(
    (config: SimConfig) => {
      worker.current?.terminate();
      const w = new Worker(new URL("../../lib/twin/worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === "snapshot") {
          setSnap(m.snapshot);
          if (m.snapshot.done) setPlaying(false);
        } else if (m.type === "results") setRes(m.results);
        else if (m.type === "section") setDetail(m.section);
      };
      worker.current = w;
      setSnap(null);
      setRes(null);
      setDetail(null);
      setPlaying(true);
      w.postMessage({ type: "start", config, speed: secondsFor(speed) } satisfies ToWorker);
    },
    [speed],
  );
  return {
    snap,
    res,
    detail,
    playing,
    speed,
    start,
    pause: () => {
      send({ type: "pause" });
      setPlaying(false);
    },
    resume: () => {
      send({ type: "resume" });
      setPlaying(true);
    },
    skip: () => {
      send({ type: "skip" });
      setPlaying(false);
    },
    setSpeed: (id: SpeedId) => {
      setSpeedId(id);
      send({ type: "speed", speed: secondsFor(id) });
    },
    inspect,
    clearDetail: () => setDetail(null),
    stop: () => {
      worker.current?.terminate();
      worker.current = null;
      setPlaying(false);
    },
  };
}
