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
  /** A Pages-hosted interface preview that intentionally has no API runtime. */
  staticPreview?: boolean;
  onConnect: () => void;
  onStart: () => void;
  preview?: boolean;
  previewState?: JevStartGatePreviewState;
}

const steps = [
  { icon: <KeyRound size={18} />, title: "连接 Jev", detail: "建立临时、短时有效的连接" },
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
  staticPreview = false,
  onConnect,
  onStart,
  preview = false,
  previewState = "default",
}: JevStartGateProps) {
  const isPreviewLoading = previewState === "loading";
  const isPreviewError = previewState === "error";
  const isPreviewDisabled = previewState === "disabled";
  const isPreviewSuccess = previewState === "success";
  const isStaticPreview = staticPreview && !preview;
  const effectiveMode: JevStartGateMode = isPreviewLoading
    ? "checking"
    : isPreviewError
      ? "error"
      : isPreviewSuccess
        ? "ready"
        : mode;
  const isReady = effectiveMode === "ready";
  const isLoading = loading || isPreviewLoading || effectiveMode === "checking";
  const isDisabled = isPreviewDisabled || isLoading || isStaticPreview;
  const copy = isStaticPreview
    ? {
        title: "静态界面预览已就绪",
        description: "此 GitHub Pages 站点只展示操作流程与界面状态；未部署 Jev API，因此不会采集量测、生成预测或伪造充放电结果。",
      }
    : copyFor(effectiveMode, source);
  const displayedError = isPreviewError ? "连接状态暂时不可用。请重新打开 Jev 连接入口。" : error;
  const canStart = !isStaticPreview && (isReady || (effectiveMode === "error" && source !== undefined));
  const activeStep = isStaticPreview ? -1 : canStart ? 1 : 0;

  const content = (
    <div className="jev-start-gate__surface">
      <div className="jev-start-gate__copy">
        <span className="jev-start-gate__mark" aria-hidden="true">
          {isStaticPreview ? <ShieldCheck size={23} /> : effectiveMode === "error" ? <TriangleAlert size={23} /> : isReady ? <CheckCircle2 size={23} /> : isLoading ? <LoaderCircle size={23} className="spinner" /> : <KeyRound size={23} />}
        </span>
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        {!isStaticPreview && displayedError && <p className="jev-start-gate__error" role="alert"><TriangleAlert size={16} />{displayedError}</p>}
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
        <p><ShieldCheck size={16} />{isStaticPreview ? "演示版不接收或保存 Jev API Key。" : "未完成连接前，不会采集现场量测、生成预测或展示充放电结果。"}</p>
        <button
          type="button"
          data-state={isStaticPreview ? "default" : isLoading ? "loading" : displayedError && !canStart ? "error" : canStart ? "success" : "default"}
          disabled={isDisabled}
          onClick={canStart ? onStart : onConnect}
        >
          {isLoading ? <LoaderCircle size={18} className="spinner" aria-hidden="true" /> : canStart ? <Cpu size={18} /> : <KeyRound size={18} />}
          <span>{isStaticPreview ? "需要部署 API" : isLoading ? "正在检查连接" : isReady ? "开始逐时决策" : canStart ? "重新开始逐时决策" : displayedError ? "重新连接 Jev" : "连接 Jev"}</span>
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
