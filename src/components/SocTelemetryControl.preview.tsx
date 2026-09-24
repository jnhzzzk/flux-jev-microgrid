import { useState } from "react";
import {
  SocTelemetryControl,
  type SocInputMode,
  type SocTelemetryPreviewState,
} from "./SocTelemetryControl";

const states: SocTelemetryPreviewState[] = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "error",
  "success",
];

function PreviewRow({ state }: { state: SocTelemetryPreviewState }) {
  const [mode, setMode] = useState<SocInputMode>(state === "default" ? "live" : "simulation");
  const [simulatedSoc, setSimulatedSoc] = useState(58);

  return (
    <section>
      <h2>{state}</h2>
      <SocTelemetryControl
        measuredSocPercent={46}
        simulatedSocPercent={simulatedSoc}
        measuredAt="2026-09-23T09:15:24+08:00"
        mode={mode}
        minSocPercent={12}
        maxSocPercent={94}
        reserveSocPercent={28}
        capacityKWh={240}
        maxPowerKW={90}
        efficiencyPercent={91}
        previewState={state}
        onModeChange={setMode}
        onSimulationChange={(value) => setSimulatedSoc(Math.round(value * 100))}
      />
    </section>
  );
}

export default function SocTelemetryControlPreview() {
  return (
    <main className="soc-telemetry-preview">
      {states.map((state) => <PreviewRow key={state} state={state} />)}
    </main>
  );
}
