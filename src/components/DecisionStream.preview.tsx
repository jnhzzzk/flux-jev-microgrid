import { DecisionStream, type DecisionStreamPreviewState } from "./DecisionStream";
import type { HourlyDispatch } from "../../shared/contracts";

const previewDecision: HourlyDispatch = {
  hour: 18,
  label: "18:00",
  loadKW: 322,
  solarKW: 7,
  netLoadKW: 315,
  tariffCnyPerKWh: 0.92,
  action: "discharge",
  batteryPowerKW: 73,
  gridPowerKW: 242,
  socBefore: 46,
  socAfter: 36,
  confidence: 0.81,
  probabilities: { charge: 0.04, hold: 0.08, discharge: 0.88 },
  rationale: "晚高峰电价窗口，放电降低购电成本",
};

const states: DecisionStreamPreviewState[] = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "error",
  "success",
];

export function DecisionStreamPreview() {
  return (
    <main className="decision-stream-preview" aria-label="DecisionStream 八状态预览">
      {states.map((state) => (
        <section key={state}>
          <h2>{state}</h2>
          <DecisionStream
            decision={previewDecision}
            selectedHour={18}
            generatedAt="2026-09-23T18:00:00+08:00"
            measuredLoadKW={322}
            measuredSolarKW={7}
            measuredSocPercent={46}
            predictedDemandKW={258}
            previewState={state}
            onAdvance={() => undefined}
          />
        </section>
      ))}
    </main>
  );
}
