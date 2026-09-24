import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  CircleGauge,
  CloudCog,
  CloudSun,
  Code2,
  Cpu,
  Factory,
  Gauge,
  KeyRound,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Wifi,
} from "lucide-react";
import type {
  DispatchAction,
  DispatchResponse,
  ForecastDispatchRequest,
  HourlyDispatch,
  MeasurementIngestRequest,
  MeasurementReceipt,
  MicrogridScenario,
  JevSessionReceipt,
  ServiceStatus,
} from "../shared/contracts";
import { DecisionStream } from "./components/DecisionStream";
import { EnergyChart } from "./components/EnergyChart";
import { JevConnectionDialog, type JevConnectionView } from "./components/JevConnectionDialog";
import { JevPacketDialog } from "./components/JevPacketDialog";
import { JevStartGate, type JevStartGateMode } from "./components/JevStartGate";
import { SocTelemetryControl, type SocInputMode } from "./components/SocTelemetryControl";
import { createScenario, type ScenarioId } from "./data/scenarios";
import { buildForecastRequest, buildMeasurementRequest } from "./data/workflow";

type WorkflowPhase = "idle" | "measuring" | "forecasting" | "deciding" | "ready" | "error";
type DecisionPresentation = "entry" | "running" | "active";

const actionCopy: Record<DispatchAction, { label: string; verb: string }> = {
  charge: { label: "充电", verb: "吸收" },
  hold: { label: "保持", verb: "待机" },
  discharge: { label: "放电", verb: "输出" },
};

const scenarioCopy: Array<{ id: ScenarioId; label: string; icon: ReactNode }> = [
  { id: "sunny", label: "晴空光伏", icon: <Sun size={19} /> },
  { id: "evening-peak", label: "制造晚高峰", icon: <Factory size={19} /> },
  { id: "cloud-drop", label: "午后云团", icon: <CloudSun size={19} /> },
  { id: "demand-control", label: "需量控制", icon: <Gauge size={19} /> },
];

const phaseIndex: Record<Exclude<WorkflowPhase, "error">, number> = {
  idle: -1,
  measuring: 0,
  forecasting: 1,
  deciding: 2,
  ready: 3,
};

function FluxMark() {
  return (
    <span className="flux-mark" aria-hidden="true">
      <svg viewBox="0 0 44 44" focusable="false">
        <path d="M10 14h16a7 7 0 0 1 0 14H16" />
        <path d="m20 23-6 6 6 6" />
        <circle cx="11" cy="14" r="2.5" />
        <circle cx="33" cy="28" r="2.5" />
      </svg>
    </span>
  );
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function apiUrl(path: string): string {
  if (!path.startsWith("/api/")) throw new Error("只允许请求应用 API。");
  return `${apiBaseUrl}${path}`;
}

async function requestJson<T>(
  path: string,
  {
    method = "GET",
    payload,
    sessionToken,
  }: {
    method?: "GET" | "POST" | "DELETE";
    payload?: unknown;
    sessionToken?: string | null;
  } = {},
): Promise<T> {
  const headers = new Headers();
  if (payload !== undefined) headers.set("Content-Type", "application/json");
  if (sessionToken) headers.set("X-Jev-Session", sessionToken);

  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });
  if (response.status === 204) return undefined as T;

  const json = await response.json().catch(() => ({})) as T | { error?: string; code?: string };
  if (!response.ok) {
    const message = "error" in json && json.error ? json.error : "服务暂时无法完成请求。";
    const code = "code" in json && typeof json.code === "string" ? json.code : undefined;
    throw new ApiRequestError(message, response.status, code);
  }
  return json as T;
}

function formatTime(value?: string): string {
  if (!value) return "等待";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatAge(value: string | undefined, now: number): string {
  if (!value) return "暂无量测";
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 5) return "刚刚更新";
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.floor(seconds / 60)} 分钟前`;
}

function shortId(value?: string): string {
  if (!value) return "等待";
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value;
}

function WorkflowStrip({
  phase,
  failedStep,
  receipt,
  forecast,
  result,
}: {
  phase: WorkflowPhase;
  failedStep: number;
  receipt: MeasurementReceipt | null;
  forecast: ForecastDispatchRequest | null;
  result: DispatchResponse | null;
}) {
  const current = phase === "error" ? failedStep : phaseIndex[phase];
  const steps = [
    {
      title: "现场量测",
      detail: receipt ? `${formatTime(receipt.measuredAt)} · 已入库` : "负荷、光伏、电网与 SOC",
      icon: <Activity size={19} />,
    },
    {
      title: "滚动预测",
      detail: forecast ? `${shortId(forecast.forecast.forecastId)} · 24 h` : "引用 measurementId",
      icon: <CloudCog size={19} />,
    },
    {
      title: "Jev 决策",
      detail: result ? `${result.meta.model} · ${result.meta.latencyMs} ms` : "24 个类型化判断",
      icon: <Cpu size={19} />,
    },
  ];

  return (
    <section className="workflow-strip" aria-label="决策输入链路" aria-live="polite">
      {steps.map((step, index) => {
        const state = phase === "error" && failedStep === index
          ? "error"
          : current > index || phase === "ready"
            ? "done"
            : current === index
              ? "active"
              : "waiting";
        return (
          <div className="workflow-step" data-state={state} key={step.title}>
            <span className="workflow-step__number">{state === "done" ? <Check size={16} /> : index + 1}</span>
            <span className="workflow-step__icon" aria-hidden="true">{step.icon}</span>
            <span className="workflow-step__copy"><strong>{step.title}</strong><small>{step.detail}</small></span>
            {state === "active" && <span className="workflow-step__pulse" aria-hidden="true" />}
          </div>
        );
      })}
    </section>
  );
}

function HourRail({
  schedule,
  selectedHour,
  onSelect,
}: {
  schedule: HourlyDispatch[];
  selectedHour: number;
  onSelect: (hour: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, hour: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = event.key === "ArrowRight" ? (hour + 1) % 24 : (hour + 23) % 24;
    onSelect(next);
    requestAnimationFrame(() => {
      railRef.current?.querySelector<HTMLButtonElement>(`[data-hour="${next}"]`)?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="hour-rail" ref={railRef} role="tablist" aria-label="24 小时调度结果">
      {schedule.map((item) => (
        <button
          type="button"
          role="tab"
          aria-selected={selectedHour === item.hour}
          tabIndex={selectedHour === item.hour ? 0 : -1}
          data-hour={item.hour}
          data-action={item.action}
          className={selectedHour === item.hour ? "is-selected" : ""}
          key={item.hour}
          aria-label={`${String(item.hour).padStart(2, "0")} 时，${actionCopy[item.action].label}，${Math.abs(item.batteryPowerKW).toFixed(0)} kW`}
          aria-controls="energy-trend"
          title={`${String(item.hour).padStart(2, "0")}:00 · ${actionCopy[item.action].label} ${Math.abs(item.batteryPowerKW).toFixed(0)} kW`}
          onClick={() => onSelect(item.hour)}
          onKeyDown={(event) => onKeyDown(event, item.hour)}
        >
          <span>{String(item.hour).padStart(2, "0")}</span>
          <b>{actionCopy[item.action].label}</b>
        </button>
      ))}
    </div>
  );
}

function ProbabilityBars({ selected }: { selected: HourlyDispatch }) {
  return (
    <div className="probability-list" aria-label="动作概率分布">
      {(["charge", "hold", "discharge"] as DispatchAction[]).map((action) => {
        const value = selected.probabilities[action];
        return (
          <div className="probability-row" key={action}>
            <span>{actionCopy[action].label}</span>
            <i><b style={{ "--probability": `${Math.round(value * 100)}%` } as CSSProperties} /></i>
            <strong>{Math.round(value * 100)}%</strong>
          </div>
        );
      })}
    </div>
  );
}

function UnifiedWorkspace({
  result,
  selected,
  selectedHour,
  measurement,
  receipt,
  forecast,
  now,
  scenario,
  scenarioId,
  dirty,
  loading,
  onSelectHour,
  onSelectScenario,
  onUpdateSoc,
  onApply,
}: {
  result: DispatchResponse;
  selected: HourlyDispatch;
  selectedHour: number;
  measurement: MeasurementIngestRequest | null;
  receipt: MeasurementReceipt | null;
  forecast: ForecastDispatchRequest | null;
  now: number;
  scenario: MicrogridScenario;
  scenarioId: ScenarioId;
  dirty: boolean;
  loading: boolean;
  onSelectHour: (hour: number) => void;
  onSelectScenario: (id: ScenarioId) => void;
  onUpdateSoc: (value: number) => void;
  onApply: () => void;
}) {
  const currentMeasurement = measurement?.values;
  const demandForecast = forecast?.forecast.demandManagement;
  const selectedDemand = demandForecast?.predictedDemand15MinKW[selectedHour];
  const hasDemandInputs = demandForecast && currentMeasurement?.demand15MinKW !== undefined;
  const [socInputMode, setSocInputMode] = useState<SocInputMode>("live");

  useEffect(() => {
    setSocInputMode("live");
  }, [scenarioId]);

  function changeSocInputMode(mode: SocInputMode) {
    if (mode === "live" && currentMeasurement) {
      onUpdateSoc(currentMeasurement.batterySocPercent / 100);
    }
    setSocInputMode(mode);
  }

  return (
    <div className="unified-workspace" id="operations-overview">
      <section className="decision-pane" aria-label="逐时决策与能量趋势">
        <header className="workspace-heading unified-heading">
          <div><h1>逐时快速决策</h1><p>先量测、再预测；动作、趋势与控制输入保持同屏。</p></div>
          <span className="source-chip" data-source={result.meta.source}>
            <i aria-hidden="true" />{result.meta.source === "jev" ? "Jev 在线" : "本地策略"}
          </span>
        </header>

        <DecisionStream
          decision={selected}
          selectedHour={selectedHour}
          generatedAt={result.meta.generatedAt}
          measuredLoadKW={currentMeasurement?.loadKW}
          measuredSolarKW={currentMeasurement?.solarKW}
          measuredSocPercent={currentMeasurement?.batterySocPercent}
          predictedDemandKW={selectedDemand}
          onAdvance={() => onSelectHour((selectedHour + 1) % 24)}
        />

        <section className="energy-workbench" aria-label="全天能量趋势与逐时动作">
          <div className="trend-heading">
            <div><ChartNoAxesCombined size={18} /><h2>全天趋势与动作</h2></div>
            <div className="chart-legend"><span><i data-series="load" />负荷</span><span><i data-series="solar" />光伏</span><span><i data-series="soc" />SOC</span></div>
            <p className="savings-inline"><span>预计节省</span><strong>¥{result.summary.savingsCny.toFixed(0)}</strong><small>−{result.summary.savingsPercent.toFixed(1)}%</small></p>
          </div>
          <EnergyChart schedule={result.schedule} selectedHour={selectedHour} />
          <div className="dispatch-timeline">
            <div className="dispatch-timeline__heading">
              <div><strong>24 小时动作</strong><span>全部时刻可直接选择</span></div>
              <output data-action={selected.action}>
                {String(selectedHour).padStart(2, "0")}:00 · {actionCopy[selected.action].label}
              </output>
            </div>
            <HourRail schedule={result.schedule} selectedHour={selectedHour} onSelect={onSelectHour} />
          </div>
          <dl className="metric-ribbon">
            <div><dt>最大购电</dt><dd>{result.summary.peakImportKW.toFixed(0)} kW</dd></div>
            <div><dt>削峰</dt><dd>{result.summary.peakReductionPercent.toFixed(1)}%</dd></div>
            <div><dt>绿电利用</dt><dd>{result.summary.renewableUtilizationPercent.toFixed(1)}%</dd></div>
            <div><dt>自供</dt><dd>{result.summary.selfSupplyPercent.toFixed(1)}%</dd></div>
            <div><dt>循环</dt><dd>{result.summary.equivalentCycles.toFixed(2)} 次</dd></div>
            <div><dt>结束 SOC</dt><dd>{result.summary.finalSoc.toFixed(0)}%</dd></div>
          </dl>
        </section>
      </section>

      <aside className={`control-dock${hasDemandInputs ? " control-dock--demand" : ""}`} aria-label="输入、判断与策略控制">
        <section className="control-section control-section--input">
          <div className="inspector-heading"><div><Activity size={18} /><h2>输入基线</h2></div><span>{formatAge(receipt?.measuredAt, now)}</span></div>
          <dl className="measurement-grid">
            <div><dt>站内负荷</dt><dd>{currentMeasurement?.loadKW.toFixed(0) ?? "—"} kW</dd></div>
            <div><dt>光伏出力</dt><dd>{currentMeasurement?.solarKW.toFixed(0) ?? "—"} kW</dd></div>
            {hasDemandInputs ? (
              <>
                <div><dt>当前 15 分钟需量</dt><dd>{currentMeasurement.demand15MinKW?.toFixed(0)} kW</dd></div>
                <div><dt>需量控制目标</dt><dd>{demandForecast.controlTargetKW.toFixed(0)} kW</dd></div>
                <div><dt>月内需量峰值</dt><dd>{currentMeasurement.billingPeakToDateKW?.toFixed(0)} kW</dd></div>
                <div><dt>实测 SOC</dt><dd>{currentMeasurement.batterySocPercent.toFixed(1)}%</dd></div>
              </>
            ) : (
              <>
                <div><dt>电网功率</dt><dd>{currentMeasurement?.gridPowerKW.toFixed(0) ?? "—"} kW</dd></div>
                <div><dt>实测 SOC</dt><dd>{currentMeasurement?.batterySocPercent.toFixed(1) ?? "—"}%</dd></div>
              </>
            )}
          </dl>
          <p className="trace-inline"><span>量测 {shortId(receipt?.measurementId)}</span><span>预测 {shortId(forecast?.forecast.forecastId)}</span></p>
        </section>

        <section className="control-section control-section--judgment">
          <div className="inspector-heading"><div><CircleGauge size={18} /><h2>Jev 判断</h2></div></div>
          <ProbabilityBars selected={selected} />
          <p className="constraint-inline"><ShieldCheck size={16} />{selected.constraint ? `硬约束：${selected.constraint}` : "功率、SOC 与防反送约束均通过"}</p>
        </section>

        <section className="control-section control-section--strategy">
          <div className="inspector-heading"><div><Settings2 size={18} /><h2>运行场景</h2></div><span>{dirty ? "待同步" : "已同步"}</span></div>
          <div className="scenario-picker" role="radiogroup" aria-label="测试场景">
            {scenarioCopy.map((item) => (
              <button
                type="button"
                role="radio"
                aria-checked={scenarioId === item.id}
                className={scenarioId === item.id ? "is-selected" : ""}
                key={item.id}
                onClick={() => onSelectScenario(item.id)}
              >
                {item.icon}<span>{item.label}</span>{scenarioId === item.id && <Check size={17} />}
              </button>
            ))}
          </div>
          <p className="scenario-note">
            {scenario.demandManagement
              ? `控制 ${scenario.demandManagement.controlTargetKW} kW · 合同 ${scenario.demandManagement.contractedDemandKW} kW · ¥${scenario.demandManagement.demandChargeCnyPerKW}/kW`
              : scenario.description}
          </p>
        </section>

        <section className="control-section control-section--soc">
          <SocTelemetryControl
            measuredSocPercent={currentMeasurement?.batterySocPercent}
            simulatedSocPercent={Math.round(scenario.battery.initialSoc * 100)}
            measuredAt={receipt?.measuredAt}
            mode={socInputMode}
            minSocPercent={Math.round(scenario.battery.minSoc * 100)}
            maxSocPercent={Math.round(scenario.battery.maxSoc * 100)}
            reserveSocPercent={Math.round(scenario.battery.reserveSoc * 100)}
            capacityKWh={scenario.battery.capacityKWh}
            maxPowerKW={scenario.battery.maxPowerKW}
            efficiencyPercent={Math.round(scenario.battery.roundTripEfficiency * 100)}
            loading={loading}
            onModeChange={changeSocInputMode}
            onSimulationChange={onUpdateSoc}
          />
        </section>

        <button
          type="button"
          className="primary-action"
          data-state={loading ? "loading" : dirty ? "default" : "success"}
          disabled={loading}
          onClick={onApply}
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : dirty ? <RefreshCw size={18} /> : <CheckCircle2 size={18} />}
          <span>{loading
            ? "正在执行量测、预测与决策"
            : dirty
              ? socInputMode === "simulation" ? "用仿真值重新决策" : "采集并重新决策"
              : socInputMode === "simulation" ? "仿真策略已同步" : "当前策略已同步"}</span>
        </button>
      </aside>
    </div>
  );
}

export default function TabletApp() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("sunny");
  const [scenario, setScenario] = useState<MicrogridScenario>(() => createScenario("sunny"));
  const [result, setResult] = useState<DispatchResponse | null>(null);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [decisionPresentation, setDecisionPresentation] = useState<DecisionPresentation>("entry");
  const [phase, setPhase] = useState<WorkflowPhase>("idle");
  const [failedStep, setFailedStep] = useState(0);
  const [measurement, setMeasurement] = useState<MeasurementIngestRequest | null>(null);
  const [receipt, setReceipt] = useState<MeasurementReceipt | null>(null);
  const [forecast, setForecast] = useState<ForecastDispatchRequest | null>(null);
  const [selectedHour, setSelectedHour] = useState(() => new Date().getHours());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [packetDialogOpen, setPacketDialogOpen] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [jevConnection, setJevConnection] = useState<JevConnectionView | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const initialized = useRef(false);
  const sequence = useRef(Date.now());
  const packetTriggerRef = useRef<HTMLButtonElement>(null);
  const connectionTriggerRef = useRef<HTMLButtonElement>(null);
  const connectionTokenRef = useRef<string | null>(null);

  function canRunJev() {
    return Boolean(connectionTokenRef.current) || Boolean(status?.jevConfigured);
  }

  function clearBrowserConnection() {
    connectionTokenRef.current = null;
    setJevConnection(null);
  }

  function resetDecisionPresentation() {
    setResult(null);
    setMeasurement(null);
    setReceipt(null);
    setForecast(null);
    setPhase("idle");
    setFailedStep(0);
    setError(null);
    setDirty(false);
    setPacketDialogOpen(false);
    setDecisionPresentation("entry");
  }

  async function runDecision(nextScenario: MicrogridScenario, keepPreviousResult: boolean): Promise<boolean> {
    setLoading(true);
    setError(null);
    setFailedStep(0);
    setPhase("measuring");
    let step = 0;

    try {
      const measurementRequest = buildMeasurementRequest(nextScenario, new Date(), sequence.current++);
      setMeasurement(measurementRequest);
      const accepted = await requestJson<MeasurementReceipt>("/api/measurements", {
        method: "POST",
        payload: measurementRequest,
      });
      setReceipt(accepted);

      step = 1;
      setPhase("forecasting");
      const forecastRequest = buildForecastRequest(nextScenario, accepted, new Date(), true);
      setForecast(forecastRequest);

      step = 2;
      setPhase("deciding");
      const dispatch = await requestJson<DispatchResponse>("/api/dispatch/forecast", {
        method: "POST",
        payload: forecastRequest,
        sessionToken: connectionTokenRef.current,
      });
      setResult(dispatch);
      setDirty(false);
      setPhase("ready");
      setDecisionPresentation("active");
      return true;
    } catch (caught) {
      const sessionExpired = caught instanceof ApiRequestError && caught.code === "jev_session_expired";
      if (sessionExpired) {
        clearBrowserConnection();
        try {
          await refreshServiceStatus(null);
        } catch {
          setStatus(null);
          setStatusChecked(true);
          setStatusError("无法确认 Jev 服务状态。请重新连接后再开始。");
        }
        setConnectionError("本次 Jev 临时会话已结束。请重新连接后再刷新决策。");
        setConnectionDialogOpen(true);
      }
      const returnToEntry = !keepPreviousResult || sessionExpired;
      if (returnToEntry) resetDecisionPresentation();
      setFailedStep(step);
      setPhase("error");
      setError(caught instanceof Error ? caught.message : "三阶段决策流程未完成，请重新采集量测。");
      if (returnToEntry) setDecisionPresentation("entry");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function startDecision(nextScenario = scenario): Promise<boolean> {
    if (!canRunJev()) {
      setConnectionError("请先连接 Jev，再开始首轮逐时决策。");
      setConnectionDialogOpen(true);
      return false;
    }

    const keepPreviousResult = decisionPresentation === "active" && Boolean(result);
    if (!keepPreviousResult) {
      resetDecisionPresentation();
      setDecisionPresentation("running");
    }
    return runDecision(nextScenario, keepPreviousResult);
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void requestJson<ServiceStatus>("/api/status")
      .then((serviceStatus) => {
        setStatus(serviceStatus);
        setStatusError(null);
      })
      .catch(() => {
        setStatus(null);
        setStatusError("无法确认 Jev 服务状态。请检查服务后重试。");
      })
      .finally(() => {
        setStatusChecked(true);
      });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = result?.schedule[selectedHour] ?? result?.schedule[0] ?? null;

  function selectScenario(id: ScenarioId) {
    const nextScenario = createScenario(id);
    setScenarioId(id);
    setScenario(nextScenario);
    const demand = nextScenario.demandManagement;
    if (demand) {
      const firstExceedance = demand.predictedDemand15MinKW.findIndex(
        (value) => value > demand.controlTargetKW,
      );
      if (firstExceedance >= 0) setSelectedHour(firstExceedance);
    }
    setDirty(true);
  }

  function updateSoc(value: number) {
    setScenario((current) => ({ ...current, battery: { ...current.battery, initialSoc: value } }));
    setDirty(true);
  }

  async function refreshServiceStatus(sessionToken = connectionTokenRef.current) {
    const nextStatus = await requestJson<ServiceStatus>("/api/status", { sessionToken });
    setStatus(nextStatus);
    setStatusChecked(true);
    setStatusError(null);
    if (sessionToken && nextStatus.jevSession?.source === "session") {
      setJevConnection({
        source: "session",
        expiresAt: nextStatus.jevSession.expiresAt,
        remainingCalls: nextStatus.jevSession.remainingCalls,
      });
    }
    return nextStatus;
  }

  async function connectJev(apiKey: string) {
    setConnectionLoading(true);
    setConnectionError(null);
    let createdSessionToken: string | null = null;
    try {
      const receipt = await requestJson<JevSessionReceipt>("/api/jev/session", {
        method: "POST",
        payload: { apiKey },
      });
      createdSessionToken = receipt.connectionToken;
      connectionTokenRef.current = receipt.connectionToken;
      setJevConnection({
        source: "session",
        expiresAt: receipt.expiresAt,
        remainingCalls: receipt.remainingCalls,
      });
      await refreshServiceStatus(receipt.connectionToken);
      resetDecisionPresentation();
      if (connectionTokenRef.current === receipt.connectionToken) {
        setConnectionDialogOpen(false);
      }
    } catch (caught) {
      if (createdSessionToken) {
        try {
          await requestJson<void>("/api/jev/session", {
            method: "DELETE",
            sessionToken: createdSessionToken,
          });
        } catch {
          // The server-side idle timeout is the fallback if this acknowledgement is lost.
        }
      }
      clearBrowserConnection();
      if (caught instanceof ApiRequestError && caught.status === 429) {
        setConnectionError("连接请求过于频繁，请稍后再试。");
      } else if (caught instanceof ApiRequestError && caught.status === 401) {
        setConnectionError("密钥未通过验证。请确认后重新粘贴。");
      } else {
        setConnectionError("暂时无法验证 Jev Key。请稍后重试。");
      }
    } finally {
      setConnectionLoading(false);
    }
  }

  async function disconnectJev() {
    const sessionToken = connectionTokenRef.current;
    setConnectionLoading(true);
    setConnectionError(null);
    try {
      if (sessionToken) {
        await requestJson<void>("/api/jev/session", {
          method: "DELETE",
          sessionToken,
        });
      }
    } catch {
      // Clearing the browser reference is the safe outcome even if the
      // browser did not receive the server acknowledgement.
    } finally {
      clearBrowserConnection();
      resetDecisionPresentation();
      try {
        await refreshServiceStatus(null);
      } catch {
        setStatus(null);
        setStatusChecked(true);
        setStatusError("无法确认 Jev 服务状态。请检查服务后重试。");
      }
      setConnectionLoading(false);
    }
  }

  function openConnectionDialog() {
    if (connectionLoading) return;
    setConnectionError(null);
    setConnectionDialogOpen(true);
  }

  function closeConnectionDialog() {
    if (connectionLoading) return;
    setConnectionDialogOpen(false);
    requestAnimationFrame(() => connectionTriggerRef.current?.focus());
  }

  function closePacketDialog() {
    setPacketDialogOpen(false);
    requestAnimationFrame(() => packetTriggerRef.current?.focus());
  }

  const hasBrowserJevSession = Boolean(jevConnection);
  const hasManagedJev = !hasBrowserJevSession && (
    status?.jevSession?.source === "environment"
    || (Boolean(status?.jevConfigured) && !status?.jevSession)
  );
  const hasJevCapability = hasBrowserJevSession || hasManagedJev;
  const startupSource = hasBrowserJevSession ? "session" : hasManagedJev ? "environment" : undefined;
  const startupError = statusError ?? error;
  const startupMode: JevStartGateMode = !statusChecked
    ? "checking"
    : startupError
      ? "error"
      : hasJevCapability
        ? "ready"
        : "connect";
  const siteMeasurementLabel = decisionPresentation === "entry"
    ? !statusChecked
      ? "正在确认 Jev"
      : hasJevCapability
        ? "等待开始逐时决策"
        : "等待 Jev 连接"
    : formatAge(receipt?.measuredAt, now);
  const siteConnectionState = !statusChecked ? "checking" : hasJevCapability ? "ready" : "waiting";
  const connectionLabel = connectionLoading
    ? "处理中"
    : hasBrowserJevSession
      ? "Jev 已连接"
      : hasManagedJev
        ? "Jev 已托管"
        : "连接 Jev";

  return (
    <div className="ipad-app ipad-app--unified">
      <div className="tablet-shell">
        <header className="tablet-toolbar">
          <div className="toolbar-identity">
            <div className="brand-inline" aria-label="Flux 微电网储能">
              <FluxMark />
              <span><strong>Flux</strong><small>微电网储能</small></span>
            </div>
            <div className="site-title"><strong>滨海园区微电网</strong><span data-state={siteConnectionState}><i aria-hidden="true" />{siteMeasurementLabel}</span></div>
          </div>
          <div className="toolbar-actions">
            <button
              ref={connectionTriggerRef}
              type="button"
              className="connection-action"
              data-state={connectionLoading ? "loading" : hasBrowserJevSession || hasManagedJev ? "success" : "default"}
              disabled={connectionLoading}
              aria-label="管理 Jev 连接"
              aria-haspopup="dialog"
              aria-expanded={connectionDialogOpen}
              onClick={openConnectionDialog}
            >
              {connectionLoading ? <span className="spinner" aria-hidden="true" /> : hasJevCapability ? <Wifi size={16} /> : <KeyRound size={16} />}
              <span>{connectionLabel}</span>
            </button>
            {decisionPresentation === "active" && <>
              <button
                ref={packetTriggerRef}
                type="button"
                className="packet-action"
                data-state={result?.jevTrace ? "success" : "default"}
                disabled={!result || loading}
                aria-haspopup="dialog"
                aria-expanded={packetDialogOpen}
                onClick={() => setPacketDialogOpen(true)}
              >
                <Code2 size={17} /><span>Jev 报文</span>
              </button>
              <button
                type="button"
                className="refresh-action"
                data-state={error ? "error" : loading ? "loading" : phase === "ready" ? "success" : "default"}
                disabled={loading || !canRunJev()}
                onClick={() => void startDecision()}
              >
                {loading ? <span className="spinner" aria-hidden="true" /> : <RefreshCw size={18} />}
                <span>{loading ? "处理中" : "刷新决策"}</span>
              </button>
            </>}
          </div>
        </header>

        {decisionPresentation !== "entry" && <WorkflowStrip phase={phase} failedStep={failedStep} receipt={receipt} forecast={forecast} result={result} />}

        {decisionPresentation === "active" && error && <div className="system-message" data-tone="error" role="alert"><ShieldCheck size={18} /><span>{error} 请重新刷新决策。</span></div>}
        {decisionPresentation === "active" && result?.meta.warning && <div className="system-message" data-tone="warning" role="status"><ShieldCheck size={18} /><span>{result.meta.warning}</span></div>}

        <main className="tablet-content">
          {decisionPresentation === "entry" ? (
            <JevStartGate
              mode={startupMode}
              source={startupSource}
              loading={connectionLoading}
              error={startupError}
              onConnect={openConnectionDialog}
              onStart={() => void startDecision()}
            />
          ) : decisionPresentation === "running" || !result || !selected ? (
            <div className="tablet-loading" aria-label="正在执行量测、预测与决策流程">
              <div><Gauge size={28} /><strong>{phase === "measuring" ? "正在接收现场量测" : phase === "forecasting" ? "正在生成滚动预测" : "正在计算逐时动作"}</strong><span>系统按顺序完成三个阶段。</span></div>
              <i /><i /><i />
            </div>
          ) : (
            <UnifiedWorkspace
              result={result}
              selected={selected}
              selectedHour={selectedHour}
              measurement={measurement}
              receipt={receipt}
              forecast={forecast}
              now={now}
              scenario={scenario}
              scenarioId={scenarioId}
              dirty={dirty}
              loading={loading}
              onSelectHour={setSelectedHour}
              onSelectScenario={selectScenario}
              onUpdateSoc={updateSoc}
              onApply={() => void startDecision()}
            />
          )}
        </main>
      </div>
      <JevPacketDialog open={packetDialogOpen} result={result} onClose={closePacketDialog} />
      <JevConnectionDialog
        open={connectionDialogOpen}
        connection={jevConnection}
        serverConfigured={hasManagedJev}
        loading={connectionLoading}
        error={connectionError}
        onClose={closeConnectionDialog}
        onConnect={connectJev}
        onDisconnect={disconnectJev}
      />
    </div>
  );
}
