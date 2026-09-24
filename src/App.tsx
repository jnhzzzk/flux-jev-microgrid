import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChartNoAxesCombined,
  Check,
  Clock3,
  CloudSun,
  Factory,
  Minus,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type {
  DispatchAction,
  DispatchRequest,
  DispatchResponse,
  HourlyDispatch,
  MicrogridScenario,
  ServiceStatus,
} from "../shared/contracts";
import { MobileEnergyChart } from "./components/MobileEnergyChart";
import {
  createScenario,
  type ScenarioId,
} from "./data/scenarios";

type TabId = "dispatch" | "trend" | "settings";

const LIVE_INTERVAL_SECONDS = 4;

const actionCopy: Record<DispatchAction, { label: string; short: string; power: string }> = {
  charge: { label: "充电", short: "充", power: "吸收" },
  hold: { label: "保持", short: "待", power: "待机" },
  discharge: { label: "放电", short: "放", power: "输出" },
};

const scenarioCopy: Array<{ id: ScenarioId; label: string; icon: ReactNode }> = [
  { id: "sunny", label: "晴空", icon: <Sun size={17} /> },
  { id: "evening-peak", label: "晚峰", icon: <Factory size={17} /> },
  { id: "cloud-drop", label: "云团", icon: <CloudSun size={17} /> },
];

function FluxMark() {
  return (
    <span className="app-icon" aria-hidden="true">
      <svg viewBox="0 0 44 44" focusable="false">
        <path d="M11 15h14.5a6.5 6.5 0 0 1 0 13H16" />
        <path d="m20 23-5 5 5 5" />
        <circle cx="12" cy="15" r="2.5" />
        <circle cx="32" cy="28" r="2.5" />
      </svg>
    </span>
  );
}

function ActionIcon({ action, size = 22 }: { action: DispatchAction; size?: number }) {
  if (action === "charge") return <ArrowDownToLine size={size} />;
  if (action === "discharge") return <ArrowUpFromLine size={size} />;
  return <Minus size={size} />;
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="metric">
      <span className="metric__copy"><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}

function SliderField({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="setting-slider">
      <span><b>{label}</b><output>{value}{unit}</output></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--progress": `${progress}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function DecisionScreen({
  result,
  selected,
  selectedHour,
  onSelectHour,
  railRef,
  liveMode,
  liveInteractionPaused,
  liveCountdown,
  onToggleLive,
  onInteractionPause,
  onInteractionResume,
}: {
  result: DispatchResponse;
  selected: HourlyDispatch;
  selectedHour: number;
  onSelectHour: (hour: number) => void;
  railRef: RefObject<HTMLDivElement | null>;
  liveMode: boolean;
  liveInteractionPaused: boolean;
  liveCountdown: number;
  onToggleLive: () => void;
  onInteractionPause: () => void;
  onInteractionResume: () => void;
}) {
  const nextHour = String((selected.hour + 1) % 24).padStart(2, "0");
  const magnitude = Math.abs(selected.batteryPowerKW);
  const powerText = selected.action === "hold"
    ? "0 kW"
    : `${actionCopy[selected.action].power} ${magnitude.toFixed(0)} kW`;

  function moveHour(event: KeyboardEvent<HTMLButtonElement>, hour: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = event.key === "ArrowRight" ? (hour + 1) % 24 : (hour + 23) % 24;
    onSelectHour(next);
    requestAnimationFrame(() => {
      railRef.current?.querySelector<HTMLButtonElement>(`[data-hour="${next}"]`)?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="screen screen--dispatch" id="panel-dispatch" role="tabpanel" aria-labelledby="tab-dispatch">
      <header className="screen-heading">
        <div>
          <span><i aria-hidden="true" />{selected.label} · 实时决策</span>
          <h1>每小时，快速决策。</h1>
        </div>
      </header>

      <section
        className="live-decision"
        data-running={liveMode && !liveInteractionPaused ? "true" : "false"}
        aria-label="实时决策状态"
        onMouseEnter={onInteractionPause}
        onMouseLeave={onInteractionResume}
        onFocusCapture={onInteractionPause}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onInteractionResume();
        }}
      >
        <div className="live-decision__status">
          <span className="live-orbit" aria-hidden="true"><i /></span>
          <p>
            <strong>{liveMode ? liveInteractionPaused ? "查看时已暂停" : "实时推演中" : "推演已暂停"}</strong>
            <span>{liveMode ? liveInteractionPaused ? "松开后继续" : "4 秒推进 1 小时" : "点按继续"}</span>
          </p>
        </div>
        <div className="live-decision__timer">
          <span><small>下一决策</small>{liveMode ? `00:0${liveCountdown}` : "—"}</span>
          <button
            type="button"
            aria-label={liveMode ? "暂停实时推演" : "继续实时推演"}
            aria-pressed={liveMode}
            onClick={onToggleLive}
          >
            {liveMode ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </button>
        </div>
        <span className="live-progress" key={`${selected.hour}-${liveMode ? "running" : "paused"}`} aria-hidden="true"><i /></span>
      </section>

      <section className="decision-card" key={selected.hour} aria-live="polite">
        <div className="decision-card__top">
          <span>{selected.label}–{nextHour}:00</span>
        <span className="model-status"><i aria-hidden="true" />{result.meta.source === "jev" ? "Jev 决策" : "本地策略"}</span>
        </div>
        <div className="decision-card__main">
          <div className={`action-mark action-mark--${selected.action}`}><ActionIcon action={selected.action} size={30} /></div>
          <div className="action-copy">
            <small>{actionCopy[selected.action].label} · {powerText}</small>
            <strong>{magnitude.toFixed(0)}<span> kW</span></strong>
            <p>当前执行功率</p>
          </div>
          <div className="confidence">
            <strong>{Math.round(selected.confidence * 100)}</strong><span>%</span>
            <small>置信度</small>
          </div>
        </div>
        <p className="decision-reason">{selected.rationale}</p>
        <div className="decision-facts">
          <span><small>SOC</small><strong>{selected.socAfter.toFixed(0)}%</strong></span>
          <span><small>电价</small><strong>¥{selected.tariffCnyPerKWh.toFixed(2)}</strong></span>
          <span><small>净负荷</small><strong>{selected.netLoadKW.toFixed(0)} kW</strong></span>
        </div>
      </section>

      <section className="hourly-section">
        <div className="section-title"><div><h2>逐时决策</h2><p>左右滑动 · 点按切换</p></div><span>{selectedHour + 1} / 24</span></div>
        <div className="hour-rail" ref={railRef} role="tablist" aria-label="逐小时决策">
          {result.schedule.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={selectedHour === item.hour}
              tabIndex={selectedHour === item.hour ? 0 : -1}
              data-hour={item.hour}
              key={item.hour}
              className={`hour-card hour-card--${item.action} ${selectedHour === item.hour ? "is-selected" : ""}`}
              onClick={() => onSelectHour(item.hour)}
              onKeyDown={(event) => moveHour(event, item.hour)}
            >
              <span>{String(item.hour).padStart(2, "0")}:00</span>
              <ActionIcon action={item.action} size={19} />
              <small>{actionCopy[item.action].short}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="metric-grid" aria-label="选中时段数据">
        <Metric label="储能功率" value={`${selected.batteryPowerKW > 0 ? "+" : ""}${selected.batteryPowerKW.toFixed(0)} kW`} />
        <Metric label="电网功率" value={`${selected.gridPowerKW.toFixed(0)} kW`} />
        <Metric label="光伏出力" value={`${selected.solarKW.toFixed(0)} kW`} />
        <Metric label="站内负荷" value={`${selected.loadKW.toFixed(0)} kW`} />
      </section>

      {selected.constraint && <div className="constraint"><ShieldCheck size={17} /><span>硬约束已介入：{selected.constraint}</span></div>}
    </div>
  );
}

function TrendScreen({ result, selectedHour }: { result: DispatchResponse; selectedHour: number }) {
  const counts = result.schedule.reduce(
    (acc, item) => ({ ...acc, [item.action]: acc[item.action] + 1 }),
    { charge: 0, hold: 0, discharge: 0 },
  );
  return (
    <div className="screen screen--trend" id="panel-trend" role="tabpanel" aria-labelledby="tab-trend">
      <header className="page-title"><span>今日概览</span><h1>能量与收益，一屏看清。</h1><p>负荷、光伏与 SOC 的日内关系。</p></header>

      <section className="summary-led">
        <div><small>预计节省</small><strong>¥{result.summary.savingsCny.toFixed(0)}</strong><span>较无储能降低 {result.summary.savingsPercent.toFixed(1)}%</span></div>
        <dl>
          <div><dt>最大购电</dt><dd>{result.summary.peakImportKW.toFixed(0)} kW</dd></div>
          <div><dt>绿电利用</dt><dd>{result.summary.renewableUtilizationPercent.toFixed(1)}%</dd></div>
          <div><dt>等效循环</dt><dd>{result.summary.equivalentCycles.toFixed(2)} 次</dd></div>
        </dl>
      </section>

      <section className="chart-section">
        <div className="section-title"><div><h2>能量轨迹</h2><p>负荷 · 光伏 · SOC</p></div><span>{String(selectedHour).padStart(2, "0")}:00</span></div>
        <MobileEnergyChart schedule={result.schedule} selectedHour={selectedHour} />
      </section>

      <section className="action-distribution">
        <div className="section-title"><div><h2>动作分布</h2><p>24 小时策略构成</p></div></div>
        <div className="distribution-row">
          {(["charge", "hold", "discharge"] as DispatchAction[]).map((action) => (
            <span key={action} className={`distribution-chip distribution-chip--${action}`}>
              <ActionIcon action={action} size={17} />
              <b>{actionCopy[action].label}</b>
              <strong>{counts[action]}</strong>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsScreen({
  scenario,
  scenarioId,
  dirty,
  loading,
  onSelectScenario,
  onUpdateBattery,
  onApply,
}: {
  scenario: MicrogridScenario;
  scenarioId: ScenarioId;
  dirty: boolean;
  loading: boolean;
  onSelectScenario: (id: ScenarioId) => void;
  onUpdateBattery: (field: "capacityKWh" | "maxPowerKW" | "initialSoc" | "reserveSoc", value: number) => void;
  onApply: () => void;
}) {
  return (
    <div className="screen screen--settings" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
      <header className="page-title page-title--settings"><h1>场景与储能边界。</h1><p>参数变更后，重新计算 24 小时动作。</p></header>

      <section className="settings-group">
        <h2>预测场景</h2>
        <div className="scenario-control" role="radiogroup" aria-label="预测场景">
          {scenarioCopy.map((item) => (
            <button
              type="button"
              role="radio"
              aria-checked={scenarioId === item.id}
              className={scenarioId === item.id ? "is-selected" : ""}
              key={item.id}
              onClick={() => onSelectScenario(item.id)}
            >
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </div>
        <p className="scenario-description">{scenario.description}</p>
      </section>

      <section className="settings-group settings-group--sliders">
        <h2>储能边界</h2>
        <SliderField label="额定容量" value={scenario.battery.capacityKWh} unit=" kWh" min={120} max={480} step={20} onChange={(value) => onUpdateBattery("capacityKWh", value)} />
        <SliderField label="最大功率" value={scenario.battery.maxPowerKW} unit=" kW" min={40} max={180} step={10} onChange={(value) => onUpdateBattery("maxPowerKW", value)} />
        <SliderField label="初始 SOC" value={Math.round(scenario.battery.initialSoc * 100)} unit="%" min={20} max={85} step={1} onChange={(value) => onUpdateBattery("initialSoc", value / 100)} />
        <SliderField label="备用 SOC" value={Math.round(scenario.battery.reserveSoc * 100)} unit="%" min={15} max={55} step={1} onChange={(value) => onUpdateBattery("reserveSoc", value / 100)} />
      </section>

      <button
        type="button"
        className={`apply-button ${loading ? "is-loading" : ""}`}
        disabled={loading}
        onClick={onApply}
      >
        {loading ? <span className="spinner" aria-hidden="true" /> : dirty ? <RefreshCw size={18} /> : <Check size={18} />}
        <span>{loading ? "正在更新" : dirty ? "应用并更新" : "策略已同步"}</span>
      </button>

      <div className="safety-card"><ShieldCheck size={19} /><p><strong>Jev 决策，代码守住边界</strong><span>SOC、功率硬约束 · 密钥仅存服务端</span></p></div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabId>("dispatch");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("sunny");
  const [scenario, setScenario] = useState<MicrogridScenario>(() => createScenario("sunny"));
  const [result, setResult] = useState<DispatchResponse | null>(null);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [selectedHour, setSelectedHour] = useState(18);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [liveMode, setLiveMode] = useState(true);
  const [liveCountdown, setLiveCountdown] = useState(LIVE_INTERVAL_SECONDS);
  const [liveInteractionPaused, setLiveInteractionPaused] = useState(false);
  const initialized = useRef(false);
  const hourRailRef = useRef<HTMLDivElement>(null);

  async function executeDispatch(useJev: boolean, nextScenario = scenario) {
    setLoading(true);
    setError(null);
    try {
      const payload: DispatchRequest = { scenario: nextScenario, useJev };
      const response = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json() as DispatchResponse | { error: string };
      if (!response.ok || "error" in json) throw new Error("error" in json ? json.error : "调度服务没有返回结果");
      setResult(json);
      setDirty(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法连接调度服务");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const initialScenario = createScenario("sunny");
    void fetch("/api/status")
      .then((response) => response.json() as Promise<ServiceStatus>)
      .then((serviceStatus) => {
        setStatus(serviceStatus);
        return executeDispatch(serviceStatus.jevConfigured, initialScenario);
      })
      .catch(() => {
        setStatus(null);
        return executeDispatch(false, initialScenario);
      });
  }, []);

  useEffect(() => {
    if (!result || tab !== "dispatch") return;
    const rail = hourRailRef.current;
    const target = rail?.querySelector<HTMLElement>(`[data-hour="${selectedHour}"]`);
    if (!rail || !target) return;
    rail.scrollTo({
      left: target.offsetLeft - (rail.clientWidth - target.clientWidth) / 2,
      behavior: "smooth",
    });
  }, [result, selectedHour, tab]);

  useEffect(() => {
    if (!result || tab !== "dispatch" || !liveMode || liveInteractionPaused) return;
    const timer = window.setInterval(() => {
      setLiveCountdown((current) => {
        if (current <= 1) {
          setSelectedHour((hour) => (hour + 1) % 24);
          return LIVE_INTERVAL_SECONDS;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [liveInteractionPaused, liveMode, result, tab]);

  function selectHour(hour: number) {
    setSelectedHour(hour);
    setLiveCountdown(LIVE_INTERVAL_SECONDS);
  }

  function toggleLiveMode() {
    setLiveMode((current) => !current);
    setLiveCountdown(LIVE_INTERVAL_SECONDS);
  }

  function selectScenario(id: ScenarioId) {
    const next = createScenario(id);
    setScenarioId(id);
    setScenario(next);
    setDirty(true);
    setSelectedHour(id === "cloud-drop" ? 14 : 18);
    setLiveCountdown(LIVE_INTERVAL_SECONDS);
  }

  function updateBattery(
    field: "capacityKWh" | "maxPowerKW" | "initialSoc" | "reserveSoc",
    value: number,
  ) {
    setScenario((current) => ({ ...current, battery: { ...current.battery, [field]: value } }));
    setDirty(true);
  }

  const selected = result?.schedule[selectedHour] ?? result?.schedule[0];
  const tabTitle: Record<TabId, string> = {
    dispatch: "逐时决策",
    trend: "能量趋势",
    settings: "策略设置",
  };
  const tabs: Array<{ id: TabId; label: string; icon: ReactNode }> = [
    { id: "dispatch", label: "决策", icon: <Clock3 size={21} /> },
    { id: "trend", label: "趋势", icon: <ChartNoAxesCombined size={21} /> },
    { id: "settings", label: "设置", icon: <Settings2 size={21} /> },
  ];

  return (
    <div className="device-stage">
      <div className="iphone-shell">
        <span className="device-button device-button--action" aria-hidden="true" />
        <span className="device-button device-button--volume-up" aria-hidden="true" />
        <span className="device-button device-button--volume-down" aria-hidden="true" />
        <span className="device-button device-button--power" aria-hidden="true" />
        <span className="device-island" aria-hidden="true"><i /><b /></span>
        <div className="mobile-app">
      <header className="app-nav">
        <a className="wordmark" href="#panel-dispatch" onClick={() => setTab("dispatch")} aria-label="返回逐时决策">
          <FluxMark /><span className="visually-hidden">Flux</span>
        </a>
        <div className="app-nav__title">
          <strong>{tabTitle[tab]}</strong>
          <span><i aria-hidden="true" className={status?.jevConfigured ? "is-online" : ""} />滨海园区微电网</span>
        </div>
        <button
          type="button"
          className={`sync-button ${loading ? "is-loading" : ""}`}
          data-state={error ? "error" : result?.meta.source === "jev" ? "success" : "default"}
          disabled={loading}
          aria-label={loading ? "正在更新策略" : "立即更新策略"}
          onClick={() => void executeDispatch(true)}
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : <RefreshCw size={16} />}
        </button>
      </header>

      {error && <div className="message message--error" role="alert">{error}</div>}
      {result?.meta.warning && <div className="message message--warning" role="status">{result.meta.warning}</div>}

      <main className="app-content">
        {!result || !selected ? (
          <div className="loading-screen" aria-label="正在生成策略">
            <span aria-hidden="true" className="loading-line loading-line--short" />
            <span aria-hidden="true" className="loading-block" />
            <span aria-hidden="true" className="loading-line" />
            <span aria-hidden="true" className="loading-line loading-line--mid" />
          </div>
        ) : (
          <div className="tab-stage" key={tab}>
            {tab === "dispatch" && (
              <DecisionScreen
                result={result}
                selected={selected}
                selectedHour={selectedHour}
                onSelectHour={selectHour}
                railRef={hourRailRef}
                liveMode={liveMode}
                liveInteractionPaused={liveInteractionPaused}
                liveCountdown={liveCountdown}
                onToggleLive={toggleLiveMode}
                onInteractionPause={() => setLiveInteractionPaused(true)}
                onInteractionResume={() => setLiveInteractionPaused(false)}
              />
            )}
            {tab === "trend" && <TrendScreen result={result} selectedHour={selectedHour} />}
            {tab === "settings" && (
              <SettingsScreen
                scenario={scenario}
                scenarioId={scenarioId}
                dirty={dirty}
                loading={loading}
                onSelectScenario={selectScenario}
                onUpdateBattery={updateBattery}
                onApply={() => void executeDispatch(true)}
              />
            )}
          </div>
        )}
      </main>

      <nav className="tab-bar" role="tablist" aria-label="主要导航">
        {tabs.map((item) => (
          <button
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            className={tab === item.id ? "is-selected" : ""}
            key={item.id}
            onClick={() => setTab(item.id)}
          >
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
      </nav>
        </div>
      </div>
    </div>
  );
}
