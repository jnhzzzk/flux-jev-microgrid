export type DispatchAction = "charge" | "hold" | "discharge";
export type DispatchSource = "jev" | "rules";

export interface BatteryConfig {
  capacityKWh: number;
  maxPowerKW: number;
  initialSoc: number;
  minSoc: number;
  maxSoc: number;
  reserveSoc: number;
  roundTripEfficiency: number;
}

export interface DispatchObjectives {
  economyWeight: number;
  peakWeight: number;
  renewableWeight: number;
}

export interface DemandManagementForecast {
  contractedDemandKW: number;
  controlTargetKW: number;
  demandChargeCnyPerKW: number;
  predictedDemand15MinKW: number[];
}

export interface DemandManagementInput extends DemandManagementForecast {
  measuredDemand15MinKW: number;
  billingPeakToDateKW: number;
}

export interface MicrogridScenario {
  id: string;
  name: string;
  description: string;
  loadKW: number[];
  solarKW: number[];
  tariffCnyPerKWh: number[];
  battery: BatteryConfig;
  objectives: DispatchObjectives;
  feedInTariffCnyPerKWh: number;
  demandManagement?: DemandManagementInput;
}

export interface OperatingMeasurement {
  loadKW: number;
  solarKW: number;
  gridPowerKW: number;
  batteryPowerKW: number;
  batterySocPercent: number;
  demand15MinKW?: number;
  billingPeakToDateKW?: number;
}

export interface MeasurementIngestRequest {
  siteId: string;
  measuredAt: string;
  sequence: number;
  values: OperatingMeasurement;
}

export interface MeasurementReceipt {
  measurementId: string;
  siteId: string;
  measuredAt: string;
  receivedAt: string;
  status: "accepted";
}

export interface IntradayForecast {
  forecastId: string;
  issuedAt: string;
  horizonStart: string;
  resolutionMinutes: 60;
  loadKW: number[];
  solarKW: number[];
  tariffCnyPerKWh: number[];
  demandManagement?: DemandManagementForecast;
}

export interface ForecastDispatchRequest {
  siteId: string;
  measurementId: string;
  forecast: IntradayForecast;
  useJev: boolean;
}

export interface ActionProbabilities {
  charge: number;
  hold: number;
  discharge: number;
}

export interface HourlyDispatch {
  hour: number;
  label: string;
  loadKW: number;
  solarKW: number;
  netLoadKW: number;
  tariffCnyPerKWh: number;
  action: DispatchAction;
  batteryPowerKW: number;
  gridPowerKW: number;
  socBefore: number;
  socAfter: number;
  confidence: number;
  probabilities: ActionProbabilities;
  rationale: string;
  constraint?: string;
}

export interface DispatchSummary {
  operatingCostCny: number;
  baselineCostCny: number;
  savingsCny: number;
  savingsPercent: number;
  peakImportKW: number;
  baselinePeakKW: number;
  peakReductionPercent: number;
  renewableUtilizationPercent: number;
  selfSupplyPercent: number;
  equivalentCycles: number;
  finalSoc: number;
}

export interface DispatchMeta {
  source: DispatchSource;
  model: string;
  generatedAt: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  measurementId?: string;
  forecastId?: string;
  warning?: string;
}

export type JevTraceValue =
  | string
  | number
  | boolean
  | null
  | JevTraceValue[]
  | { [key: string]: JevTraceValue };

export interface JevChoiceAnswer {
  type: "choice";
  choice: DispatchAction;
  probabilities: ActionProbabilities;
  confidence: number;
}

/**
 * The literal System One exchange, kept separate from the deterministic
 * dispatch plan because hard operating constraints may alter final power.
 */
export interface JevTrace {
  request: {
    model: string;
    state: JevTraceValue;
    questions: Record<string, JevTraceValue>;
  };
  response: {
    model: string;
    answers: Record<string, JevChoiceAnswer>;
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
  };
}

export interface DispatchResponse {
  schedule: HourlyDispatch[];
  summary: DispatchSummary;
  meta: DispatchMeta;
  jevTrace?: JevTrace;
}

export interface DispatchRequest {
  scenario: MicrogridScenario;
  useJev: boolean;
}

export interface ServiceStatus {
  ready: boolean;
  jevConfigured: boolean;
  defaultModel: string;
  /** Safe connection metadata only; never contains an API key or token. */
  jevSession?: JevSessionInfo;
}

export interface JevSessionInfo {
  active: boolean;
  source: "none" | "session" | "environment";
  /** Absolute server-side expiry for a browser session. */
  expiresAt?: string;
  /** Available Jev dispatch calls in the current short session window. */
  remainingCalls?: number;
}

/**
 * Sent once after successful browser-key verification. `connectionToken` is
 * opaque, short lived, and must remain only in transient client memory.
 */
export interface JevSessionReceipt {
  connectionToken: string;
  expiresAt: string;
  remainingCalls: number;
  source: "session";
}
