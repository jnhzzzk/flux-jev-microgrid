import type { DispatchResponse, JevTrace } from "../../shared/contracts";
import {
  JevPacketDialog,
  type JevPacketDialogPreviewState,
} from "./JevPacketDialog";

const states: JevPacketDialogPreviewState[] = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "error",
  "success",
];

const trace: JevTrace = {
  request: {
    model: "jev-latest",
    state: {
      site: { scenario_name: "滨海园区微电网" },
      observation: { battery_SOC_percent: 46, load_kW: 178, solar_kW: 92 },
    },
    questions: {
      hour_00: { type: "choice", instructions: "Choose the battery operating intent for 00:00–01:00." },
    },
  },
  response: {
    model: "jev-1.13.0",
    answers: {
      hour_00: {
        type: "choice",
        choice: "charge",
        probabilities: { charge: 0.82, hold: 0.14, discharge: 0.04 },
        confidence: 0.76,
      },
    },
    usage: { inputTokens: 328, outputTokens: 34 },
  },
};

const result: DispatchResponse = {
  schedule: [],
  summary: {
    operatingCostCny: 0,
    baselineCostCny: 0,
    savingsCny: 0,
    savingsPercent: 0,
    peakImportKW: 0,
    baselinePeakKW: 0,
    peakReductionPercent: 0,
    renewableUtilizationPercent: 0,
    selfSupplyPercent: 0,
    equivalentCycles: 0,
    finalSoc: 46,
  },
  meta: {
    source: "jev",
    model: "jev-1.13.0",
    generatedAt: "2026-09-23T09:15:24+08:00",
    latencyMs: 427,
  },
  jevTrace: trace,
};

export default function JevPacketDialogPreview() {
  return (
    <main className="jev-packet-dialog-preview" aria-label="Jev 调度报文八状态预览">
      {states.map((state) => (
        <section key={state}>
          <h2>{state}</h2>
          <JevPacketDialog
            open
            result={state === "error" ? { ...result, jevTrace: undefined } : result}
            onClose={() => undefined}
            preview
            previewState={state}
          />
        </section>
      ))}
    </main>
  );
}
