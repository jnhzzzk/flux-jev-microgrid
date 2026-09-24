import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Minus,
  Pause,
  Play,
  Radio,
} from "lucide-react";
import type { DispatchAction, HourlyDispatch } from "../../shared/contracts";

const STREAM_INTERVAL_MS = 4000;

const actionCopy: Record<DispatchAction, { label: string; verb: string }> = {
  charge: { label: "充电", verb: "吸收" },
  hold: { label: "保持", verb: "待机" },
  discharge: { label: "放电", verb: "输出" },
};

export type DecisionStreamPreviewState =
  | "default"
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "loading"
  | "error"
  | "success";

export interface DecisionStreamProps {
  decision: HourlyDispatch;
  selectedHour: number;
  generatedAt: string;
  measuredLoadKW?: number;
  measuredSolarKW?: number;
  measuredSocPercent?: number;
  predictedDemandKW?: number;
  /** Makes Pages-only output explicitly local rather than a Jev decision stream. */
  mode?: "jev" | "local-simulation";
  /** Convenience flag for the Pages local simulation. */
  localSimulation?: boolean;
  onAdvance: () => void;
  previewState?: DecisionStreamPreviewState;
}

function ActionIcon({ action, size = 24 }: { action: DispatchAction; size?: number }) {
  if (action === "charge") return <ArrowDownToLine size={size} />;
  if (action === "discharge") return <ArrowUpFromLine size={size} />;
  return <Minus size={size} />;
}

function formatStreamTime(value: string, offsetSeconds: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  date.setSeconds(date.getSeconds() + offsetSeconds);
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function valueOrDash(value: number | undefined, digits = 0): string {
  return value === undefined ? "—" : value.toFixed(digits);
}

export function DecisionStream({
  decision,
  selectedHour,
  generatedAt,
  measuredLoadKW,
  measuredSolarKW,
  measuredSocPercent,
  predictedDemandKW,
  mode = "jev",
  localSimulation,
  onAdvance,
  previewState = "default",
}: DecisionStreamProps) {
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;

  const canStream = !["disabled", "loading", "error"].includes(previewState);
  const running = playing && !held && canStream;
  const nextHour = (selectedHour + 1) % 24;
  const power = Math.abs(decision.batteryPowerKW);
  const action = actionCopy[decision.action];
  const probability = Math.round(decision.probabilities[decision.action] * 100);
  const isLocalSimulation = localSimulation ?? mode === "local-simulation";
  const demandLabel = predictedDemandKW === undefined ? "净负荷" : "15 分钟需量";
  const demandValue = predictedDemandKW ?? decision.netLoadKW;

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => onAdvanceRef.current(), STREAM_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const statusText = previewState === "loading"
    ? isLocalSimulation ? "正在计算下一时段" : "正在接收新判断"
    : previewState === "error"
      ? isLocalSimulation ? "推演中断" : "决策流中断"
      : previewState === "success"
        ? isLocalSimulation ? "推演已更新" : "指令已同步"
      : !playing
        ? "已暂停"
        : held
          ? "查看中，暂缓推进"
            : isLocalSimulation ? "逐时推演中" : "逐时推送中";

  return (
    <section
      className="decision-stream"
      data-action={decision.action}
      data-running={running ? "true" : "false"}
      data-preview-state={previewState}
      aria-label={isLocalSimulation ? "本地逐时推演" : "逐时实时决策流"}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false);
      }}
    >
      <header className="decision-stream__header">
        <div className="stream-live">
          <span className="stream-live__dot" aria-hidden="true" />
          <Radio size={17} aria-hidden="true" />
          <strong>{isLocalSimulation ? "本地逐时推演" : "实时决策流"}</strong>
          <small>{statusText}</small>
        </div>
        <div className="stream-window">
          <span>{String(selectedHour).padStart(2, "0")}:00 → {String(nextHour).padStart(2, "0")}:00</span>
          <button
            type="button"
            className="stream-toggle"
            aria-label={playing ? isLocalSimulation ? "暂停本地逐时推演" : "暂停逐时决策流" : isLocalSimulation ? "继续本地逐时推演" : "继续逐时决策流"}
            aria-pressed={!playing}
            disabled={!canStream}
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
        </div>
      </header>

      <div className="decision-stream__body">
        <ol className="stream-feed" key={`${selectedHour}-${generatedAt}`} aria-label="当前决策事件">
          <li style={{ "--stream-index": 0 } as React.CSSProperties}>
            <time>{formatStreamTime(generatedAt, 0)}</time>
            <span className="stream-stage">{isLocalSimulation ? "样本量测" : "量测"}</span>
            <p>负荷 {valueOrDash(measuredLoadKW)} kW · 光伏 {valueOrDash(measuredSolarKW)} kW · SOC {valueOrDash(measuredSocPercent, 1)}%</p>
          </li>
          <li style={{ "--stream-index": 1 } as React.CSSProperties}>
            <time>{formatStreamTime(generatedAt, 1)}</time>
            <span className="stream-stage">{isLocalSimulation ? "预置预测" : "预测"}</span>
            <p>净负荷 {decision.netLoadKW.toFixed(0)} kW · {demandLabel} {demandValue.toFixed(0)} kW · 电价 ¥{decision.tariffCnyPerKWh.toFixed(2)}</p>
          </li>
          <li style={{ "--stream-index": 2 } as React.CSSProperties}>
            <time>{formatStreamTime(generatedAt, 2)}</time>
            <span className="stream-stage">{isLocalSimulation ? "规则计算" : "判断"}</span>
            <p>{decision.rationale} · {isLocalSimulation ? "约束已校核" : `${action.label}概率 ${probability}%`}</p>
          </li>
          <li className="stream-feed__command" style={{ "--stream-index": 3 } as React.CSSProperties}>
            <time>{formatStreamTime(generatedAt, 3)}</time>
            <span className="stream-stage">{isLocalSimulation ? "仿真结果" : "指令"}</span>
            <p><strong>{action.label} {power.toFixed(0)} kW</strong> · SOC 调整至 {decision.socAfter.toFixed(0)}%</p>
          </li>
        </ol>

        <div className="stream-command" aria-live="polite" aria-atomic="true">
          <span className="stream-command__icon"><ActionIcon action={decision.action} size={25} /></span>
          <small>{isLocalSimulation ? "仿真结果" : "最终指令"}</small>
          <strong>{action.label}</strong>
          <p>{power.toFixed(0)}<span> kW</span></p>
          <dl>
            {isLocalSimulation
              ? <div><dt>需量</dt><dd>{demandValue.toFixed(0)} kW</dd></div>
              : <div><dt>置信</dt><dd>{Math.round(decision.confidence * 100)}%</dd></div>}
            <div><dt>SOC</dt><dd>{decision.socAfter.toFixed(0)}%</dd></div>
          </dl>
        </div>
      </div>

      <span className="stream-progress" key={`${selectedHour}-${playing}-${held}`} aria-hidden="true"><i /></span>
    </section>
  );
}
