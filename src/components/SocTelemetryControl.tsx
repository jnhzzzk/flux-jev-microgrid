import {
  BatteryCharging,
  CheckCircle2,
  Clock3,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useId, type CSSProperties } from "react";

export type SocInputMode = "live" | "simulation";
export type SocTelemetryPreviewState =
  | "default"
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "loading"
  | "error"
  | "success";

export interface SocTelemetryControlProps {
  measuredSocPercent?: number;
  simulatedSocPercent: number;
  measuredAt?: string;
  mode: SocInputMode;
  minSocPercent: number;
  maxSocPercent: number;
  reserveSocPercent: number;
  capacityKWh: number;
  maxPowerKW: number;
  efficiencyPercent: number;
  /** Distinguishes real BMS telemetry from Pages-local preset samples. */
  dataSource?: "bms" | "sample";
  /** Convenience flag for the Pages local simulation. */
  localSimulation?: boolean;
  loading?: boolean;
  onModeChange: (mode: SocInputMode) => void;
  onSimulationChange: (value: number) => void;
  previewState?: SocTelemetryPreviewState;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatMeasurementTime(value?: string): string {
  if (!value) return "等待采集";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function SocTelemetryControl({
  measuredSocPercent,
  simulatedSocPercent,
  measuredAt,
  mode,
  minSocPercent,
  maxSocPercent,
  reserveSocPercent,
  capacityKWh,
  maxPowerKW,
  efficiencyPercent,
  dataSource = "bms",
  localSimulation,
  loading = false,
  onModeChange,
  onSimulationChange,
  previewState = "default",
}: SocTelemetryControlProps) {
  const sliderId = useId();
  const measured = measuredSocPercent ?? simulatedSocPercent;
  const meterPosition = clamp(
    ((measured - minSocPercent) / Math.max(1, maxSocPercent - minSocPercent)) * 100,
    0,
    100,
  );
  const simulationProgress = clamp(((simulatedSocPercent - 20) / 65) * 100, 0, 100);
  const isDisabled = previewState === "disabled";
  const isLoading = loading || previewState === "loading";
  const isError = previewState === "error";
  const isSuccess = previewState === "success";
  const isSample = localSimulation ?? dataSource === "sample";
  const sourceName = isSample ? "样本" : "实测";
  const liveSocTitle = isSample ? "样本 SOC" : "实测 SOC";

  const status = isLoading
    ? { label: isSample ? "正在载入" : "正在刷新", icon: <LoaderCircle size={14} /> }
    : isError
      ? { label: "校验失败", icon: <TriangleAlert size={14} /> }
      : isSuccess
        ? { label: isSample ? "样本已载入" : "量测已同步", icon: <CheckCircle2 size={14} /> }
        : measuredAt
          ? { label: isSample ? "样本就绪" : "校验通过", icon: <ShieldCheck size={14} /> }
          : { label: isSample ? "等待样本" : "等待量测", icon: <Clock3 size={14} /> };

  return (
    <section
      className="soc-telemetry"
      data-mode={mode}
      data-preview-state={previewState}
      aria-label={isSample ? "储能 SOC 样本与本地仿真输入" : "储能 SOC 量测与仿真输入"}
      aria-busy={isLoading}
    >
      <header className="soc-telemetry__header">
        <div>
          <BatteryCharging size={18} />
          <h2>{mode === "live" ? liveSocTitle : "SOC 仿真"}</h2>
        </div>
        <button
          type="button"
          className="soc-mode-button"
          disabled={isDisabled || isLoading}
          aria-pressed={mode === "simulation"}
          aria-label={mode === "live" ? `开启 ${isSample ? "本地" : "SOC"} 仿真调试` : `退出 ${isSample ? "本地" : "SOC"} 仿真调试`}
          onClick={() => onModeChange(mode === "live" ? "simulation" : "live")}
        >
          {isLoading ? <LoaderCircle size={15} /> : mode === "live" ? <FlaskConical size={15} /> : <RotateCcw size={15} />}
          <span>{isLoading ? (isSample ? "载入中" : "刷新中") : mode === "live" ? "仿真" : `返回${sourceName}`}</span>
        </button>
      </header>

      {mode === "live" ? (
        <div className="soc-live-readout">
          <div className="soc-reading">
            <div><span>当前电量</span><strong>{measured.toFixed(1)}%</strong></div>
            <span className="soc-quality" data-tone={isError ? "error" : isLoading ? "loading" : "ok"}>
              {status.icon}{status.label}
            </span>
          </div>

          <div
            className="soc-meter"
            role="meter"
            aria-label={isSample ? "样本 SOC" : "BMS 实测 SOC"}
            aria-valuemin={minSocPercent}
            aria-valuemax={maxSocPercent}
            aria-valuenow={Math.round(measured)}
            aria-valuetext={`${measured.toFixed(1)}%，安全范围 ${minSocPercent}% 至 ${maxSocPercent}%`}
            style={{ "--soc-position": `${meterPosition}%` } as CSSProperties}
          >
            <i aria-hidden="true" />
            <b aria-hidden="true" />
          </div>
          <div className="soc-meter-labels" aria-hidden="true">
            <span>下限 {minSocPercent}%</span><strong>当前 {measured.toFixed(0)}%</strong><span>上限 {maxSocPercent}%</span>
          </div>

          <p className="soc-source-line">
            <span><ShieldCheck size={14} />来源 {isSample ? "预置样本" : "BMS"}</span>
            <span><Clock3 size={14} />{isSample ? "载入 " : ""}{formatMeasurementTime(measuredAt)}</span>
            <span><LockKeyhole size={14} />{isSample ? "本地" : "只读"}</span>
          </p>
        </div>
      ) : (
        <div className="soc-simulation">
          <div className="soc-simulation__comparison">
            <span>{sourceName}<strong>{measured.toFixed(1)}%</strong></span>
            <span>仿真<output htmlFor={sliderId}>{simulatedSocPercent.toFixed(0)}%</output></span>
          </div>
          <label htmlFor={sliderId}>{isSample ? "下一轮本地仿真使用的模拟 SOC" : "下一轮决策使用的模拟 SOC"}</label>
          <input
            id={sliderId}
            className="soc-simulation__slider"
            type="range"
            min="20"
            max="85"
            step="1"
            value={simulatedSocPercent}
            disabled={isDisabled || isLoading}
            aria-invalid={isError || undefined}
            aria-describedby={`${sliderId}-note`}
            style={{ "--progress": `${simulationProgress}%` } as CSSProperties}
            onChange={(event) => onSimulationChange(Number(event.target.value) / 100)}
          />
          <div className="soc-simulation__range" aria-hidden="true"><span>20%</span><span>85%</span></div>
          <p id={`${sliderId}-note`} className="soc-simulation__notice" role={isError ? "alert" : undefined}>
            <TriangleAlert size={14} />
            {isError ? "仿真值未通过校验，请调整后重试。" : isSample ? "仅供本地仿真调整，不写入设备。" : "仅供下一轮测试，不写入 BMS。"}
          </p>
        </div>
      )}

      <p className="soc-policy" aria-label="储能只读约束">
        <span>{capacityKWh} kWh</span>
        <span>{maxPowerKW} kW</span>
        <span>备用 {reserveSocPercent}%</span>
        <span>效率 {efficiencyPercent}%</span>
      </p>
    </section>
  );
}
