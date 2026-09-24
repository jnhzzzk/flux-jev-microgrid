import {
  Activity,
  CheckCircle2,
  CloudCog,
  Cpu,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

export type JevStartGateMode = "checking" | "connect" | "ready" | "error";

export type JevStartGatePreviewState =
  | "default"
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "loading"
  | "error"
  | "success";

export interface JevStartGateProps {
  mode: JevStartGateMode;
  source?: "session" | "environment";
  loading?: boolean;
  error?: string | null;
  onConnect: () => void;
  onStart: () => void;
  preview?: boolean;
  previewState?: JevStartGatePreviewState;
}

const steps = [
  { icon: <KeyRound size={18} />, title: "连接 Jev", detail: "建立临时、可撤销的会话" },
  { icon: <Activity size={18} />, title: "读取现场量测", detail: "从当前时刻开始建立基线" },
  { icon: <CloudCog size={18} />, title: "生成逐时动作", detail: "预测后才输出充放电结果" },
];

function copyFor(mode: JevStartGateMode, source?: "session" | "environment") {
  if (mode === "checking") {
    return {
      title: "正在确认 Jev 连接状态",
      description: "在确认可用连接前，系统不会采集量测或生成任何充放电结果。",
    };
  }
  if (mode === "ready") {
    return {
      title: source === "session" ? "Jev 已临时连接，尚未开始" : "受管 Jev 已就绪，尚未开始",
      description: "连接已就绪，但量测、预测和逐时控制都还没有执行。由你确认后才开始首轮决策。",
    };
  }
  if (mode === "error") {
    return {
      title: "尚未进入逐时决策",
      description: "尚未读取现场量测或执行策略，因此没有展示不完整的输入或旧结果。请检查连接后重新开始。",
    };
  }
  return {
    title: "先连接 Jev，再开始逐时决策",
    description: "当前没有量测、预测、控制配置或充放电结果，避免把未运行的策略误当成实时决策。",
  };
}

/**
 * The deliberate cold-start state for Flux. It keeps the operational
 * workbench absent until the user has explicitly chosen a Jev connection.
 */
export function JevStartGate({
  mode,
  source,
  loading = false,
  error,
  onConnect,
  onStart,
  preview = false,
  previewState = "default",
}: JevStartGateProps) {
  const isPreviewLoading = previewState === "loading";
  const isPreviewError = previewState === "error";
  const isPreviewDisabled = previewState === "disabled";
  const isPreviewSuccess = previewState === "success";
  const effectiveMode: JevStartGateMode = isPreviewLoading
    ? "checking"
    : isPreviewError
      ? "error"
      : isPreviewSuccess
        ? "ready"
        : mode;
  const isReady = effectiveMode === "ready";
  const isLoading = loading || isPreviewLoading || effectiveMode === "checking";
  const isDisabled = isPreviewDisabled || isLoading;
  const copy = copyFor(effectiveMode, source);
  const displayedError = isPreviewError ? "连接状态暂时不可用。请重新打开 Jev 连接入口。" : error;
  const canStart = isReady || (effectiveMode === "error" && source !== undefined);
  const activeStep = canStart ? 1 : 0;

  const content = (
    <div className="jev-start-gate__surface">
      <div className="jev-start-gate__copy">
        <span className="jev-start-gate__mark" aria-hidden="true">
          {effectiveMode === "error" ? <TriangleAlert size={23} /> : isReady ? <CheckCircle2 size={23} /> : isLoading ? <LoaderCircle size={23} className="spinner" /> : <KeyRound size={23} />}
        </span>
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        {displayedError && <p className="jev-start-gate__error" role="alert"><TriangleAlert size={16} />{displayedError}</p>}
      </div>

      <ol className="jev-start-gate__steps" aria-label="逐时决策启动顺序">
        {steps.map((step, index) => {
          const state = index < activeStep ? "complete" : index === activeStep ? "active" : "waiting";
          return (
            <li key={step.title} data-state={state}>
              <span className="jev-start-gate__step-number">{index + 1}</span>
              <span className="jev-start-gate__step-icon" aria-hidden="true">{step.icon}</span>
              <div><strong>{step.title}</strong><small>{step.detail}</small></div>
            </li>
          );
        })}
      </ol>

      <footer className="jev-start-gate__footer">
        <p><ShieldCheck size={16} />未完成连接前，不会采集现场量测、生成预测或展示充放电结果。</p>
        <button
          type="button"
          data-state={isLoading ? "loading" : displayedError && !canStart ? "error" : canStart ? "success" : "default"}
          disabled={isDisabled}
          onClick={canStart ? onStart : onConnect}
        >
          {isLoading ? <LoaderCircle size={18} className="spinner" aria-hidden="true" /> : canStart ? <Cpu size={18} /> : <KeyRound size={18} />}
          <span>{isLoading ? "正在检查连接" : isReady ? "开始逐时决策" : canStart ? "重新开始逐时决策" : displayedError ? "重新连接 Jev" : "连接 Jev"}</span>
        </button>
      </footer>
    </div>
  );

  if (preview) {
    return (
      <section className="jev-start-gate jev-start-gate--preview" data-mode={effectiveMode} data-preview-state={previewState} aria-label={`Jev 启动状态：${previewState}`}>
        {content}
      </section>
    );
  }

  return (
    <section className="jev-start-gate" data-mode={effectiveMode} data-preview-state={previewState} aria-live="polite">
      {content}
    </section>
  );
}
