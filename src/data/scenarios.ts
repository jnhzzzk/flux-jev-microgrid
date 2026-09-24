import type { MicrogridScenario } from "../../shared/contracts";

export type ScenarioId = "sunny" | "evening-peak" | "cloud-drop" | "demand-control";

const tariff = [
  0.31, 0.31, 0.31, 0.31, 0.31, 0.34,
  0.42, 0.68, 0.78, 0.78, 0.56, 0.52,
  0.52, 0.52, 0.56, 0.62, 0.76, 0.92,
  1.18, 1.18, 1.18, 1.05, 0.72, 0.42,
];

const baseBattery = {
  capacityKWh: 240,
  maxPowerKW: 90,
  initialSoc: 0.46,
  minSoc: 0.12,
  maxSoc: 0.94,
  reserveSoc: 0.28,
  roundTripEfficiency: 0.91,
};

const objectiveDefaults = {
  economyWeight: 0.5,
  peakWeight: 0.28,
  renewableWeight: 0.22,
};

const scenarios: Record<ScenarioId, Omit<MicrogridScenario, "battery" | "objectives">> = {
  sunny: {
    id: "sunny",
    name: "晴空高光伏",
    description: "午间存在明显光伏富余，目标是在低价与绿电窗口充电，并覆盖晚高峰。",
    loadKW: [
      76, 72, 69, 68, 70, 82, 108, 148, 172, 166, 154, 149,
      152, 148, 151, 160, 178, 212, 236, 248, 231, 202, 154, 108,
    ],
    solarKW: [
      0, 0, 0, 0, 0, 4, 20, 55, 98, 142, 181, 205,
      218, 210, 184, 143, 92, 41, 10, 0, 0, 0, 0, 0,
    ],
    tariffCnyPerKWh: tariff,
    feedInTariffCnyPerKWh: 0.23,
  },
  "evening-peak": {
    id: "evening-peak",
    name: "制造晚高峰",
    description: "17–21 时生产负荷陡升，储能需兼顾削峰和峰谷套利。",
    loadKW: [
      92, 87, 84, 82, 85, 102, 132, 168, 191, 184, 175, 172,
      179, 183, 188, 201, 228, 274, 318, 336, 309, 252, 182, 126,
    ],
    solarKW: [
      0, 0, 0, 0, 0, 3, 17, 43, 75, 108, 136, 154,
      163, 158, 139, 108, 70, 32, 8, 0, 0, 0, 0, 0,
    ],
    tariffCnyPerKWh: tariff,
    feedInTariffCnyPerKWh: 0.23,
  },
  "cloud-drop": {
    id: "cloud-drop",
    name: "午后云团",
    description: "13 时后光伏预测骤降，测试 Jev 是否会提前保留电量并控制循环。",
    loadKW: [
      80, 75, 72, 70, 74, 88, 116, 151, 173, 169, 160, 158,
      162, 166, 174, 186, 203, 224, 247, 258, 241, 207, 161, 116,
    ],
    solarKW: [
      0, 0, 0, 0, 0, 4, 21, 58, 103, 149, 176, 190,
      172, 102, 64, 48, 35, 18, 4, 0, 0, 0, 0, 0,
    ],
    tariffCnyPerKWh: tariff,
    feedInTariffCnyPerKWh: 0.23,
  },
  "demand-control": {
    id: "demand-control",
    name: "需量控制",
    description: "根据现场 15 分钟需量与滚动预测，在预计越过 245 kW 前直接调整原有充放电动作。",
    loadKW: [
      96, 91, 88, 87, 90, 108, 139, 181, 210, 224, 219, 216,
      220, 224, 231, 242, 258, 286, 322, 338, 326, 278, 214, 156,
    ],
    solarKW: [
      0, 0, 0, 0, 0, 3, 16, 41, 72, 104, 132, 149,
      158, 153, 135, 105, 68, 31, 7, 0, 0, 0, 0, 0,
    ],
    tariffCnyPerKWh: tariff,
    feedInTariffCnyPerKWh: 0.23,
    demandManagement: {
      contractedDemandKW: 300,
      controlTargetKW: 245,
      demandChargeCnyPerKW: 46,
      measuredDemand15MinKW: 228,
      billingPeakToDateKW: 238,
      predictedDemand15MinKW: [
        104, 99, 95, 94, 96, 116, 152, 203, 232, 241, 229, 226,
        222, 225, 233, 244, 258, 286, 322, 338, 326, 278, 214, 156,
      ],
    },
  },
};

export const scenarioOptions: Array<{
  id: ScenarioId;
  label: string;
  eyebrow: string;
}> = [
  { id: "sunny", label: "晴空高光伏", eyebrow: "PV surplus" },
  { id: "evening-peak", label: "制造晚高峰", eyebrow: "Peak shaving" },
  { id: "cloud-drop", label: "午后云团", eyebrow: "Forecast shock" },
  { id: "demand-control", label: "需量控制", eyebrow: "Demand limit" },
];

export function createScenario(id: ScenarioId): MicrogridScenario {
  const selected = scenarios[id];
  return {
    ...selected,
    loadKW: [...selected.loadKW],
    solarKW: [...selected.solarKW],
    tariffCnyPerKWh: [...selected.tariffCnyPerKWh],
    demandManagement: selected.demandManagement ? {
      ...selected.demandManagement,
      predictedDemand15MinKW: [...selected.demandManagement.predictedDemand15MinKW],
    } : undefined,
    battery: { ...baseBattery },
    objectives: { ...objectiveDefaults },
  };
}
