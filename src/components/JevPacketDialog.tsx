import {
  Check,
  Code2,
  Copy,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { DispatchResponse } from "../../shared/contracts";

type PacketTab = "input" | "output";
type CopyState = "default" | "loading" | "error" | "success";

export type JevPacketDialogPreviewState =
  | "default"
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "loading"
  | "error"
  | "success";

export interface JevPacketDialogProps {
  open: boolean;
  result: DispatchResponse | null;
  onClose: () => void;
  previewState?: JevPacketDialogPreviewState;
  preview?: boolean;
}

function formatPacket(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function tabCopy(tab: PacketTab): string {
  return tab === "input" ? "Jev 输入" : "Jev 输出";
}

export function JevPacketDialog({
  open,
  result,
  onClose,
  previewState = "default",
  preview = false,
}: JevPacketDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const inputPanelId = useId();
  const outputPanelId = useId();
  const [activeTab, setActiveTab] = useState<PacketTab>("input");
  const [copyState, setCopyState] = useState<CopyState>("default");
  const trace = result?.jevTrace;
  const isLoading = previewState === "loading";
  const isPreviewError = previewState === "error";
  const hasTrace = Boolean(trace) && !isLoading && !isPreviewError;
  const isDisabled = previewState === "disabled";
  const outputPacket = trace && result ? {
    jev_response: trace.response,
    executed_dispatch: {
      schedule: result.schedule,
      summary: result.summary,
      meta: result.meta,
    },
  } : null;
  const activePacket = activeTab === "input" ? trace?.request : outputPacket;
  const packetJson = activePacket ? formatPacket(activePacket) : "";
  const fallbackMessage = result?.meta.warning
    ?? (result
      ? "本轮采用本地策略，没有产生可审阅的 Jev 原始报文。"
      : "尚未完成决策，请先执行一次刷新决策。"
    );

  useEffect(() => {
    if (preview) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => {
        const firstTab = tabListRef.current?.querySelector<HTMLButtonElement>("[role='tab']");
        (firstTab ?? dialog.querySelector<HTMLButtonElement>(".jev-packet-dialog__close"))?.focus();
      });
    }
    if (!open && dialog.open) dialog.close();
  }, [open, preview]);

  useEffect(() => {
    setActiveTab("input");
    setCopyState("default");
  }, [open, result?.meta.generatedAt]);

  function selectTab(tab: PacketTab) {
    setActiveTab(tab);
    setCopyState("default");
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: PacketTab) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" || (event.key === "ArrowLeft" && tab === "output")
      ? "input"
      : event.key === "End" || (event.key === "ArrowRight" && tab === "input")
        ? "output"
        : tab;
    selectTab(next);
    requestAnimationFrame(() => {
      tabListRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    });
  }

  async function copyPacket() {
    if (!packetJson || isDisabled || isLoading) return;
    setCopyState("loading");
    try {
      await navigator.clipboard.writeText(packetJson);
      setCopyState("success");
      window.setTimeout(() => setCopyState("default"), 2500);
    } catch {
      setCopyState("error");
    }
  }

  const header = (
    <header className="jev-packet-dialog__header">
      <div>
        <span className="jev-packet-dialog__mark" aria-hidden="true"><Code2 size={18} /></span>
        <div>
          <h2 id={titleId}>Jev 调度报文</h2>
          <p id={descriptionId}>实测与预测形成输入；原始判断与硬约束后的执行计划分开保留。</p>
        </div>
      </div>
      <button type="button" className="jev-packet-dialog__close" aria-label="关闭 Jev 调度报文" disabled={isDisabled} onClick={onClose}>
        <X size={18} />
      </button>
    </header>
  );

  const meta = (
    <dl className="jev-packet-dialog__meta" aria-label="Jev 调用元数据">
      <div><dt>来源</dt><dd>{result?.meta.source === "jev" ? "Jev" : "本地策略"}</dd></div>
      <div><dt>模型</dt><dd>{trace?.response.model ?? result?.meta.model ?? "—"}</dd></div>
      <div><dt>时延</dt><dd>{result ? `${result.meta.latencyMs} ms` : "—"}</dd></div>
      <div><dt>令牌</dt><dd>{trace ? `${trace.response.usage.inputTokens} / ${trace.response.usage.outputTokens}` : "—"}</dd></div>
    </dl>
  );

  const tabs = (
    <div className="jev-packet-dialog__tabs" ref={tabListRef} role="tablist" aria-label="Jev 报文内容">
      {(["input", "output"] as PacketTab[]).map((tab) => {
        const selected = activeTab === tab;
        const panelId = tab === "input" ? inputPanelId : outputPanelId;
        return (
          <button
            type="button"
            role="tab"
            id={`${panelId}-tab`}
            aria-selected={selected}
            aria-controls={panelId}
            data-tab={tab}
            key={tab}
            tabIndex={selected ? 0 : -1}
            disabled={isDisabled}
            onClick={() => selectTab(tab)}
            onKeyDown={(event) => handleTabKeyDown(event, tab)}
          >
            {tabCopy(tab)}
          </button>
        );
      })}
      <button
        type="button"
        className="jev-packet-dialog__copy"
        data-state={copyState}
        disabled={!hasTrace || isDisabled}
        onClick={() => void copyPacket()}
      >
        {copyState === "loading" ? <LoaderCircle size={16} /> : copyState === "success" ? <Check size={16} /> : copyState === "error" ? <TriangleAlert size={16} /> : <Copy size={16} />}
        <span>{copyState === "loading" ? "复制中" : copyState === "success" ? "已复制" : copyState === "error" ? "复制失败" : "复制 JSON"}</span>
      </button>
    </div>
  );

  const body = isLoading ? (
    <div className="jev-packet-dialog__status" data-tone="loading" role="status">
      <LoaderCircle size={20} /><div><strong>正在整理 Jev 报文</strong><span>调用完成后将显示输入与输出。</span></div>
    </div>
  ) : !hasTrace ? (
    <div className="jev-packet-dialog__status" data-tone="error" role="alert">
      <TriangleAlert size={20} /><div><strong>没有可展示的 Jev 原始报文</strong><span>{fallbackMessage}</span></div>
    </div>
  ) : (
    <>
      {tabs}
      <section
        id={activeTab === "input" ? inputPanelId : outputPanelId}
        className="jev-packet-dialog__panel"
        role="tabpanel"
        aria-labelledby={`${activeTab === "input" ? inputPanelId : outputPanelId}-tab`}
      >
        <div className="jev-packet-dialog__panel-heading">
          <div>
            <strong>{activeTab === "input" ? "发送至 Jev 的 state 与 questions" : "Jev 原始回答"}</strong>
            <span>{activeTab === "input" ? "不包含 API Key" : "下方执行计划已通过 SOC、功率与需量约束校核"}</span>
          </div>
          {activeTab === "output" && <span className="jev-packet-dialog__verified"><ShieldCheck size={15} />已校核</span>}
        </div>
        <pre aria-label={`${tabCopy(activeTab)} JSON`}>{packetJson}</pre>
      </section>
    </>
  );

  const content = (
    <div className="jev-packet-dialog__surface">
      {header}
      {meta}
      <div className="jev-packet-dialog__body">{body}</div>
    </div>
  );

  if (preview) {
    return (
      <section
        className="jev-packet-dialog jev-packet-dialog--preview"
        data-preview-state={previewState}
        data-copy-state={copyState}
        aria-labelledby={titleId}
      >
        {content}
      </section>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="jev-packet-dialog"
      data-preview-state={previewState}
      data-copy-state={copyState}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={isLoading}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {content}
    </dialog>
  );
}
