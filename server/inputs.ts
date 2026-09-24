import { randomUUID } from "node:crypto";
import type {
  BatteryConfig,
  DispatchObjectives,
  ForecastDispatchRequest,
  MeasurementIngestRequest,
  MeasurementReceipt,
  MicrogridScenario,
} from "../shared/contracts.js";

export interface StoredMeasurement extends MeasurementIngestRequest {
  measurementId: string;
  receivedAt: string;
}

const batteryProfile: Omit<BatteryConfig, "initialSoc"> = {
  capacityKWh: 240,
  maxPowerKW: 90,
  minSoc: 0.12,
  maxSoc: 0.94,
  reserveSoc: 0.28,
  roundTripEfficiency: 0.91,
};

const objectiveProfile: DispatchObjectives = {
  economyWeight: 0.5,
  peakWeight: 0.28,
  renewableWeight: 0.22,
};

const siteProfiles = {
  "binhai-microgrid": {
    name: "滨海园区微电网",
    battery: batteryProfile,
    objectives: objectiveProfile,
    feedInTariffCnyPerKWh: 0.23,
  },
} as const;

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} 必须是非负有限数值`);
  }
}

function requireTimestamp(value: string, field: string): void {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} 必须是有效的 ISO 时间`);
  }
}

export function validateMeasurement(input: MeasurementIngestRequest): void {
  if (!input.siteId?.trim()) throw new Error("缺少 siteId");
  if (!(input.siteId in siteProfiles)) throw new Error(`未知场站：${input.siteId}`);
  requireTimestamp(input.measuredAt, "measuredAt");
  if (!Number.isInteger(input.sequence) || input.sequence < 0) {
    throw new Error("sequence 必须是非负整数");
  }

  requireFiniteNonNegative(input.values.loadKW, "values.loadKW");
  requireFiniteNonNegative(input.values.solarKW, "values.solarKW");
  if (!Number.isFinite(input.values.gridPowerKW)) throw new Error("values.gridPowerKW 必须是有限数值");
  if (!Number.isFinite(input.values.batteryPowerKW)) throw new Error("values.batteryPowerKW 必须是有限数值");
  if (
    !Number.isFinite(input.values.batterySocPercent) ||
    input.values.batterySocPercent < 0 ||
    input.values.batterySocPercent > 100
  ) {
    throw new Error("values.batterySocPercent 必须在 0–100 之间");
  }

  const hasDemand = input.values.demand15MinKW !== undefined;
  const hasBillingPeak = input.values.billingPeakToDateKW !== undefined;
  if (hasDemand !== hasBillingPeak) {
    throw new Error("需量量测必须同时包含 demand15MinKW 与 billingPeakToDateKW");
  }
  if (hasDemand && hasBillingPeak) {
    requireFiniteNonNegative(input.values.demand15MinKW!, "values.demand15MinKW");
    requireFiniteNonNegative(input.values.billingPeakToDateKW!, "values.billingPeakToDateKW");
  }
}

export function acceptMeasurement(
  input: MeasurementIngestRequest,
  now = new Date(),
): { stored: StoredMeasurement; receipt: MeasurementReceipt } {
  validateMeasurement(input);
  const measurementId = `m-${randomUUID()}`;
  const receivedAt = now.toISOString();
  const stored: StoredMeasurement = { ...input, measurementId, receivedAt };
  return {
    stored,
    receipt: {
      measurementId,
      siteId: input.siteId,
      measuredAt: input.measuredAt,
      receivedAt,
      status: "accepted",
    },
  };
}

export function buildScenarioFromForecast(
  measurement: StoredMeasurement,
  request: ForecastDispatchRequest,
): MicrogridScenario {
  if (request.siteId !== measurement.siteId) {
    throw new Error("预测场站与量测场站不一致");
  }
  if (request.measurementId !== measurement.measurementId) {
    throw new Error("预测引用的 measurementId 不匹配");
  }

  const forecast = request.forecast;
  if (!forecast?.forecastId?.trim()) throw new Error("缺少 forecast.forecastId");
  requireTimestamp(forecast.issuedAt, "forecast.issuedAt");
  requireTimestamp(forecast.horizonStart, "forecast.horizonStart");
  if (Date.parse(forecast.issuedAt) < Date.parse(measurement.measuredAt)) {
    throw new Error("预测发布时间不能早于所引用的量测时间");
  }
  if (forecast.resolutionMinutes !== 60) throw new Error("当前仅支持 60 分钟预测分辨率");

  const series = [forecast.loadKW, forecast.solarKW, forecast.tariffCnyPerKWh];
  if (series.some((values) => !Array.isArray(values) || values.length !== 24)) {
    throw new Error("负荷、光伏和电价预测都必须包含 24 个小时值");
  }
  for (const [index, values] of series.entries()) {
    for (const value of values) requireFiniteNonNegative(value, `forecast.series[${index}]`);
  }

  const demand = forecast.demandManagement;
  if (demand) {
    if (
      measurement.values.demand15MinKW === undefined ||
      measurement.values.billingPeakToDateKW === undefined
    ) {
      throw new Error("需量预测必须引用包含 15 分钟需量与月内峰值的现场量测");
    }
    requireFiniteNonNegative(demand.contractedDemandKW, "forecast.demandManagement.contractedDemandKW");
    requireFiniteNonNegative(demand.controlTargetKW, "forecast.demandManagement.controlTargetKW");
    requireFiniteNonNegative(demand.demandChargeCnyPerKW, "forecast.demandManagement.demandChargeCnyPerKW");
    if (demand.controlTargetKW <= 0 || demand.controlTargetKW > demand.contractedDemandKW) {
      throw new Error("需量控制目标必须大于 0 且不高于合同需量");
    }
    if (!Array.isArray(demand.predictedDemand15MinKW) || demand.predictedDemand15MinKW.length !== 24) {
      throw new Error("15 分钟最大需量预测必须包含 24 个小时值");
    }
    for (const value of demand.predictedDemand15MinKW) {
      requireFiniteNonNegative(value, "forecast.demandManagement.predictedDemand15MinKW");
    }
  }

  const profile = siteProfiles[request.siteId as keyof typeof siteProfiles];
  return {
    id: forecast.forecastId,
    name: `${profile.name} · 滚动预测`,
    description: `基于 ${measurement.measuredAt} 的最新量测与 ${forecast.issuedAt} 发布的预测`,
    loadKW: [...forecast.loadKW],
    solarKW: [...forecast.solarKW],
    tariffCnyPerKWh: [...forecast.tariffCnyPerKWh],
    battery: {
      ...profile.battery,
      initialSoc: measurement.values.batterySocPercent / 100,
    },
    objectives: { ...profile.objectives },
    feedInTariffCnyPerKWh: profile.feedInTariffCnyPerKWh,
    demandManagement: demand ? {
      ...demand,
      measuredDemand15MinKW: measurement.values.demand15MinKW!,
      billingPeakToDateKW: measurement.values.billingPeakToDateKW!,
      predictedDemand15MinKW: [...demand.predictedDemand15MinKW],
    } : undefined,
  };
}
