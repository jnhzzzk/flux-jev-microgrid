import { JevStartGate, type JevStartGatePreviewState } from "./JevStartGate";

const states: JevStartGatePreviewState[] = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "error",
  "success",
];

function modeFor(state: JevStartGatePreviewState) {
  if (state === "success") return "ready" as const;
  if (state === "error") return "error" as const;
  if (state === "loading") return "checking" as const;
  return "connect" as const;
}

/** Visual-state sheet used for manual Hallmark review. */
export default function JevStartGatePreview() {
  return (
    <main className="jev-start-gate-preview">
      {states.map((state) => (
        <section key={state}>
          <h2>{state}</h2>
          <JevStartGate
            mode={modeFor(state)}
            source={state === "success" ? "session" : undefined}
            error={state === "error" ? "服务状态暂时不可用。" : null}
            onConnect={() => undefined}
            onStart={() => undefined}
            preview
            previewState={state}
          />
        </section>
      ))}
    </main>
  );
}
