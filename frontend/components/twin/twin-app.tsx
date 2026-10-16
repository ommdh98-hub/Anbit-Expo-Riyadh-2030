"use client";
import { useEffect, useState } from "react";
import { defaultConfig, type SimConfig } from "../../lib/twin/engine";
import ControlRoom from "./control-room";
import Results from "./results";
import { saveLastRun } from "./last-run";
import Setup from "./setup";
import { useTwinSim } from "./use-twin-sim";

type Stage = "setup" | "run" | "results";

// Three steps, one at a time: setup → live run → results.
export default function TwinApp() {
  const sim = useTwinSim();
  const [stage, setStage] = useState<Stage>("setup");
  // Setup defaults: Riyadh, spring, 28 days, actual 2025 weather.
  const [config, setConfig] = useState<SimConfig>(() => defaultConfig({ city: "riyadh", season: "spring", days: 28, weather: "real2025" }));
  const start = (next: SimConfig) => {
    setConfig(next);
    setStage("run");
    sim.start(next);
  };
  // A finished run is summarised for the Reports page (this browser only).
  useEffect(() => {
    if (sim.res) saveLastRun(sim.res);
  }, [sim.res]);
  // Results replace the control room automatically when the run ends.
  const shown: Stage = stage === "run" && sim.res ? "results" : stage;
  return (
    <main className="tw-main" key={shown}>
      {shown === "setup" && <Setup initial={config} onStart={start} />}
      {shown === "run" && (
        <ControlRoom
          config={config}
          snap={sim.snap}
          playing={sim.playing}
          speed={sim.speed}
          detail={sim.detail}
          onPause={sim.pause}
          onResume={sim.resume}
          onSkip={sim.skip}
          onSpeed={sim.setSpeed}
          onInspect={sim.inspect}
          onCloseDetail={sim.clearDetail}
        />
      )}
      {shown === "results" && sim.res && (
        <Results
          r={sim.res}
          onReplay={() => start(config)}
          onEdit={() => {
            sim.stop();
            setStage("setup");
          }}
        />
      )}
    </main>
  );
}
