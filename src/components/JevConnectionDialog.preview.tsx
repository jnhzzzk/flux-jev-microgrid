import {
  JevConnectionDialog,
  type JevConnectionDialogPreviewState,
} from "./JevConnectionDialog";

const states: JevConnectionDialogPreviewState[] = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "error",
  "success",
];

export default function JevConnectionDialogPreview() {
  return (
    <main className="jev-connection-dialog-preview" aria-label="Jev 连接八状态预览">
      {states.map((state) => (
        <section key={state}>
          <h2>{state}</h2>
          <JevConnectionDialog
            open
            connection={state === "success" ? {
              source: "session",
              expiresAt: "2026-09-24T17:30:00+08:00",
              remainingCalls: 7,
            } : null}
            serverConfigured={state !== "success"}
            loading={false}
            error={null}
            onClose={() => undefined}
            onConnect={() => undefined}
            onDisconnect={() => undefined}
            preview
            previewState={state}
          />
        </section>
      ))}
      <section>
        <h2>local-simulation</h2>
        <JevConnectionDialog
          open
          connection={null}
          serverConfigured={false}
          loading={false}
          error={null}
          staticPreview
          onClose={() => undefined}
          onConnect={() => undefined}
          onDisconnect={() => undefined}
          onStartSimulation={() => undefined}
          preview
        />
      </section>
    </main>
  );
}
