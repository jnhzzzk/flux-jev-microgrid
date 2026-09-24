import type {
  ActionProbabilities,
  DispatchAction,
  DispatchResponse,
  HourlyDispatch,
  MicrogridScenario,
} from "./contracts.js";

/**
 * A typed input to the deterministic dispatch engine. Both the Jev adapter
 * and the browser-only demonstration can provide these without importing one
 * another's runtime dependencies.
 */
export interface DispatchIntent {
  action: DispatchAction;
  confidence: number;
  probabilities: ActionProbabilities;
}

const EPSILON = 1e-8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * fraction);
  return sorted[index];
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function oneHot(action: DispatchAction, confidence = 0.72): ActionProbabilities {
  const remainder = (1 - confidence) / 2;
  return {
    charge: action === "charge" ? confidence : remainder,
    hold: action === "hold" ? confidence : remainder,
    discharge: action === "discharge" ? confidence : remainder,
  };
}

export function deriveRuleIntents(scenario: MicrogridScenario): DispatchIntent[] {
  const lowPrice = percentile(scenario.tariffCnyPerKWh, 0.3);
  const highPrice = percentile(scenario.tariffCnyPerKWh, 0.72);
  const peakNetLoad = percentile(
    scenario.loadKW.map((load, hour) => load - scenario.solarKW[hour]),
    0.75,
  );

  return scenario.loadKW.map((load, hour) => {
    const solar = scenario.solarKW[hour];
    const price = scenario.tariffCnyPerKWh[hour];
    const netLoad = load - solar;
    let action: DispatchAction = "hold";
    let confidence = 0.66;

    if (solar > load * 1.04 || price <= lowPrice) {
      action = "charge";
      confidence = solar > load ? 0.86 : 0.76;
    }
    if (price >= highPrice && netLoad > Math.max(0, peakNetLoad * 0.72)) {
      action = "discharge";
      confidence = price > highPrice ? 0.86 : 0.77;
    }

    const demand = scenario.demandManagement;
    const predictedDemand = demand?.predictedDemand15MinKW[hour];
    if (demand && predictedDemand !== undefined) {
      const exceedance = predictedDemand - demand.controlTargetKW;
      if (exceedance > EPSILON) {
        action = "discharge";
        confidence = clamp(0.82 + exceedance / Math.max(demand.controlTargetKW, 1), 0.82, 0.96);
      } else if (
        action === "charge" &&
        predictedDemand + batteryChargeGuard(scenario) > demand.controlTargetKW
      ) {
        action = "hold";
        confidence = 0.8;
      }
    }

    return { action, confidence, probabilities: oneHot(action, confidence) };
  });
}

function batteryChargeGuard(scenario: MicrogridScenario): number {
  return scenario.battery.maxPowerKW * 0.34;
}

function buildRationale(
  scenario: MicrogridScenario,
  hour: number,
  action: DispatchAction,
): string {
  const price = scenario.tariffCnyPerKWh[hour];
  const netLoad = scenario.loadKW[hour] - scenario.solarKW[hour];
  const low = percentile(scenario.tariffCnyPerKWh, 0.3);
  const high = percentile(scenario.tariffCnyPerKWh, 0.72);
  const demand = scenario.demandManagement;
  const predictedDemand = demand?.predictedDemand15MinKW[hour];

  if (
    action === "discharge" &&
    demand &&
    predictedDemand !== undefined &&
    predictedDemand > demand.controlTargetKW
  ) {
    return `15 分钟需量 ${round(predictedDemand)} kW，越限 ${round(predictedDemand - demand.controlTargetKW)} kW，放电削峰`;
  }
  if (
    action === "hold" &&
    demand &&
    predictedDemand !== undefined &&
    predictedDemand + batteryChargeGuard(scenario) > demand.controlTargetKW
  ) {
    return `预计需量接近 ${round(demand.controlTargetKW)} kW 控制目标，暂停充电避免抬高月内峰值`;
  }

  if (action === "charge") {
    if (netLoad < 0) return "光伏出力超过负荷，优先吸收本地富余绿电";
    if (price <= low) return "处于当日低价时段，为后续高价窗口预充";
    return "为后续净负荷峰值建立可调节能量";
  }
  if (action === "discharge") {
    if (price >= high) return "处于高价窗口，放电降低购电成本";
    return "净负荷偏高，放电用于削减需量峰值";
  }
  if (netLoad < 0) return "当前储能空间或后续价值有限，暂不额外循环";
  return "当前充放电收益有限，保留能量等待更优窗口";
}

export function validateScenario(scenario: MicrogridScenario): void {
  const series = [scenario.loadKW, scenario.solarKW, scenario.tariffCnyPerKWh];
  if (series.some((values) => !Array.isArray(values) || values.length !== 24)) {
    throw new Error("负荷、光伏和电价曲线都必须包含 24 个小时值");
  }
  if (series.flat().some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("曲线数据必须是非负有限数值");
  }
  const battery = scenario.battery;
  if (battery.capacityKWh <= 0 || battery.maxPowerKW <= 0) {
    throw new Error("储能容量和最大功率必须大于 0");
  }
  if (
    battery.minSoc < 0 ||
    battery.maxSoc > 1 ||
    battery.minSoc >= battery.maxSoc ||
    battery.initialSoc < battery.minSoc ||
    battery.initialSoc > battery.maxSoc ||
    battery.reserveSoc < battery.minSoc ||
    battery.reserveSoc > battery.maxSoc
  ) {
    throw new Error("SOC 参数不满足 min ≤ initial/reserve ≤ max");
  }
  if (battery.roundTripEfficiency <= 0 || battery.roundTripEfficiency > 1) {
    throw new Error("往返效率必须在 0–1 之间");
  }

  const demand = scenario.demandManagement;
  if (demand) {
    const scalarInputs = [
      demand.contractedDemandKW,
      demand.controlTargetKW,
      demand.demandChargeCnyPerKW,
      demand.measuredDemand15MinKW,
      demand.billingPeakToDateKW,
    ];
    if (scalarInputs.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error("需量管理输入必须是非负有限数值");
    }
    if (demand.controlTargetKW <= 0 || demand.controlTargetKW > demand.contractedDemandKW) {
      throw new Error("需量控制目标必须大于 0 且不高于合同需量");
    }
    if (
      !Array.isArray(demand.predictedDemand15MinKW) ||
      demand.predictedDemand15MinKW.length !== 24 ||
      demand.predictedDemand15MinKW.some((value) => !Number.isFinite(value) || value < 0)
    ) {
      throw new Error("15 分钟最大需量预测必须包含 24 个非负有限数值");
    }
  }
}

export function runDispatch(
  scenario: MicrogridScenario,
  intents: DispatchIntent[],
): Omit<DispatchResponse, "meta"> {
  validateScenario(scenario);
  if (intents.length !== 24) throw new Error("调度意图必须包含 24 个小时值");

  const { battery } = scenario;
  const chargeEfficiency = Math.sqrt(battery.roundTripEfficiency);
  const dischargeEfficiency = chargeEfficiency;
  const highPrice = percentile(scenario.tariffCnyPerKWh, 0.8);
  let soc = battery.initialSoc;
  const schedule: HourlyDispatch[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    const intent = intents[hour];
    const loadKW = scenario.loadKW[hour];
    const solarKW = scenario.solarKW[hour];
    const netLoadKW = loadKW - solarKW;
    const tariff = scenario.tariffCnyPerKWh[hour];
    const socBefore = soc;
    const demand = scenario.demandManagement;
    const predictedDemand = demand?.predictedDemand15MinKW[hour];
    const demandExceedanceKW = demand && predictedDemand !== undefined
      ? Math.max(0, predictedDemand - demand.controlTargetKW)
      : 0;
    let action = intent.action;
    let constraint: string | undefined;

    if (demandExceedanceKW > EPSILON) {
      if (action !== "discharge") constraint = "15 分钟需量目标触发放电";
      action = "discharge";
    } else if (
      action === "charge" &&
      demand &&
      predictedDemand !== undefined &&
      predictedDemand >= demand.controlTargetKW
    ) {
      action = "hold";
      constraint = "15 分钟需量目标限制充电";
    }

    const selectedProbability = intent.probabilities[action];
    const intensity = clamp(0.34 + 0.66 * selectedProbability, 0.34, 1);
    let batteryPowerKW = 0;

    if (action === "charge") {
      const storageRoomKWh = Math.max(0, (battery.maxSoc - soc) * battery.capacityKWh);
      const maxByEnergy = storageRoomKWh / chargeEfficiency;
      const surplusSolarKW = Math.max(0, -netLoadKW);
      const requestedKW = Math.max(
        battery.maxPowerKW * intensity,
        Math.min(battery.maxPowerKW, surplusSolarKW),
      );
      const demandHeadroomKW = demand && predictedDemand !== undefined
        ? Math.max(0, demand.controlTargetKW - predictedDemand)
        : Number.POSITIVE_INFINITY;
      const actualChargeKW = Math.min(
        battery.maxPowerKW,
        requestedKW,
        maxByEnergy,
        demandHeadroomKW,
      );
      batteryPowerKW = -actualChargeKW;
      soc += (actualChargeKW * chargeEfficiency) / battery.capacityKWh;
      if (actualChargeKW + EPSILON < requestedKW) {
        constraint = demandHeadroomKW + EPSILON < requestedKW
          ? "15 分钟需量目标限制充电"
          : "达到 SOC 上限";
      }
    } else if (action === "discharge") {
      const floorSoc = demandExceedanceKW > EPSILON || tariff >= highPrice
        ? battery.minSoc
        : Math.max(battery.minSoc, battery.reserveSoc);
      const availableKWh = Math.max(0, (soc - floorSoc) * battery.capacityKWh);
      const maxByEnergy = availableKWh * dischargeEfficiency;
      const intentPowerKW = battery.maxPowerKW * intensity;
      const targetPowerKW = demandExceedanceKW > EPSILON
        ? demandExceedanceKW
        : intentPowerKW;
      const requestedKW = Math.min(
        battery.maxPowerKW,
        Math.max(0, netLoadKW),
        targetPowerKW,
      );
      const actualDischargeKW = Math.min(battery.maxPowerKW, requestedKW, maxByEnergy);
      batteryPowerKW = actualDischargeKW;
      soc -= actualDischargeKW / dischargeEfficiency / battery.capacityKWh;
      if (actualDischargeKW + EPSILON < demandExceedanceKW) {
        constraint = "需量目标受功率或 SOC 限制";
      } else if (demandExceedanceKW > EPSILON) {
        constraint ??= "15 分钟需量目标生效";
      } else if (actualDischargeKW + EPSILON < requestedKW) {
        constraint = tariff >= highPrice ? "达到最低 SOC" : "保留备用 SOC";
      } else if (netLoadKW <= 0) {
        constraint = "禁止储能向电网反送";
      }
    }

    soc = clamp(soc, battery.minSoc, battery.maxSoc);
    const gridPowerKW = netLoadKW - batteryPowerKW;
    schedule.push({
      hour,
      label: hourLabel(hour),
      loadKW: round(loadKW),
      solarKW: round(solarKW),
      netLoadKW: round(netLoadKW),
      tariffCnyPerKWh: round(tariff, 3),
      action,
      batteryPowerKW: round(batteryPowerKW),
      gridPowerKW: round(gridPowerKW),
      socBefore: round(socBefore * 100, 1),
      socAfter: round(soc * 100, 1),
      confidence: round(intent.confidence, 3),
      probabilities: {
        charge: round(intent.probabilities.charge, 3),
        hold: round(intent.probabilities.hold, 3),
        discharge: round(intent.probabilities.discharge, 3),
      },
      rationale: buildRationale(scenario, hour, action),
      constraint,
    });
  }

  const costForGrid = (gridKW: number, hour: number) =>
    Math.max(0, gridKW) * scenario.tariffCnyPerKWh[hour] -
    Math.max(0, -gridKW) * scenario.feedInTariffCnyPerKWh;
  const operatingCostCny = schedule.reduce(
    (total, item) => total + costForGrid(item.gridPowerKW, item.hour),
    0,
  );
  const baselineGrid = scenario.loadKW.map(
    (load, hour) => load - scenario.solarKW[hour],
  );
  const baselineCostCny = baselineGrid.reduce(
    (total, gridKW, hour) => total + costForGrid(gridKW, hour),
    0,
  );
  const baselinePeakKW = Math.max(0, ...baselineGrid);
  const peakImportKW = Math.max(0, ...schedule.map((item) => item.gridPowerKW));
  const totalSolar = scenario.solarKW.reduce((sum, value) => sum + value, 0);
  const exported = schedule.reduce(
    (sum, item) => sum + Math.max(0, -item.gridPowerKW),
    0,
  );
  const totalLoad = scenario.loadKW.reduce((sum, value) => sum + value, 0);
  const imported = schedule.reduce(
    (sum, item) => sum + Math.max(0, item.gridPowerKW),
    0,
  );
  const throughput = schedule.reduce(
    (sum, item) => sum + Math.abs(item.batteryPowerKW),
    0,
  );
  const savingsCny = baselineCostCny - operatingCostCny;

  return {
    schedule,
    summary: {
      operatingCostCny: round(operatingCostCny),
      baselineCostCny: round(baselineCostCny),
      savingsCny: round(savingsCny),
      savingsPercent: round((savingsCny / Math.max(baselineCostCny, EPSILON)) * 100, 1),
      peakImportKW: round(peakImportKW),
      baselinePeakKW: round(baselinePeakKW),
      peakReductionPercent: round(
        ((baselinePeakKW - peakImportKW) / Math.max(baselinePeakKW, EPSILON)) * 100,
        1,
      ),
      renewableUtilizationPercent: round(
        (1 - exported / Math.max(totalSolar, EPSILON)) * 100,
        1,
      ),
      selfSupplyPercent: round(
        (1 - imported / Math.max(totalLoad, EPSILON)) * 100,
        1,
      ),
      equivalentCycles: round(throughput / (2 * battery.capacityKWh), 2),
      finalSoc: round(soc * 100, 1),
    },
  };
}
