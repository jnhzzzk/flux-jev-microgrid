import {
  TypeSafeClient,
  choice,
  type ChoiceCriteria,
  type ChoiceQuestion,
  type EntryType,
} from "@typesafe-ai/sdk";
import type {
  ActionProbabilities,
  DispatchAction,
  JevChoiceAnswer,
  JevTrace,
  JevTraceValue,
  MeasurementIngestRequest,
  MicrogridScenario,
} from "../shared/contracts.js";

const actionCriteria = {
  charge: {
    meaning: "Store energy during this hour.",
    choose_when: [
      "The tariff is low relative to the same day's other hours.",
      "Solar production exceeds local load and storage avoids curtailment or low-value export.",
      "Charging now prepares the battery for a clearly more valuable later peak.",
    ],
    avoid_when: "This is already a high-value discharge hour, or charging would push 15-minute demand above its control target, unless renewable surplus dominates.",
  },
  hold: {
    meaning: "Keep the battery approximately idle during this hour.",
    choose_when: [
      "Charging or discharging has weak economic and operational value.",
      "Preserving energy for a later peak is more useful.",
      "The evidence is mixed and cycling is not justified.",
      "Demand is near its control target and charging would create a new billing peak.",
    ],
  },
  discharge: {
    meaning: "Use stored energy to serve local load during this hour.",
    choose_when: [
      "The tariff or net load is high relative to the same day's other hours.",
      "Discharging reduces a meaningful import peak.",
      "The predicted maximum 15-minute demand exceeds the demand-control target.",
      "There was an earlier low-cost or renewable charging opportunity.",
    ],
    avoid_when: "Local net load is zero or negative, or scarce energy is more valuable in a later peak.",
  },
} satisfies ChoiceCriteria;

type ActionQuestion = ChoiceQuestion<typeof actionCriteria>;

export interface JevIntent {
  action: DispatchAction;
  confidence: number;
  probabilities: ActionProbabilities;
}

export interface JevIntentResult {
  intents: JevIntent[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  trace: JevTrace;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00–${String((hour + 1) % 24).padStart(2, "0")}:00`;
}

function asTraceValue(value: unknown): JevTraceValue {
  return JSON.parse(JSON.stringify(value)) as JevTraceValue;
}

function createJevClient(apiKey?: string, timeout = 20_000): TypeSafeClient {
  return new TypeSafeClient({
    ...(apiKey ? { apiKey } : {}),
    defaultModel: "jev-latest",
    timeout,
    retry: { maxRetries: 0 },
    logLevel: "off",
  });
}

/**
 * Checks credentials with a lightweight authenticated API call. The caller is
 * responsible for mapping all provider errors to a generic user-safe message.
 */
export async function verifyJevApiKey(apiKey: string): Promise<void> {
  const client = createJevClient(apiKey, 10_000);
  await client.models.list();
}

export async function askJevForIntents(
  scenario: MicrogridScenario,
  measurement?: MeasurementIngestRequest,
  apiKey?: string,
): Promise<JevIntentResult> {
  const client = createJevClient(apiKey);

  const forecast = scenario.loadKW.map((loadKW, hour) => ({
    hour,
    interval: hourLabel(hour),
    load_kW: loadKW,
    solar_kW: scenario.solarKW[hour],
    net_load_kW: Number((loadKW - scenario.solarKW[hour]).toFixed(2)),
    tariff_CNY_per_kWh: scenario.tariffCnyPerKWh[hour],
    ...(scenario.demandManagement ? {
      predicted_max_15_min_demand_kW: scenario.demandManagement.predictedDemand15MinKW[hour],
    } : {}),
  }));

  const questions: Record<string, ActionQuestion> = {};
  for (let hour = 0; hour < 24; hour += 1) {
    questions[`hour_${String(hour).padStart(2, "0")}`] = choice(
      {
        task: `Choose the battery operating intent for ${hourLabel(hour)} in the supplied 24-hour microgrid forecast.`,
        scope: "Return one battery operating intent, not a power setpoint. Deterministic code will enforce demand target, SOC, power, efficiency, reserve, and energy-balance constraints afterward.",
        comparison: "Compare this hour with the entire forecast, including future tariff peaks, net-load peaks, solar-surplus windows, and predicted 15-minute demand peaks when supplied.",
        priorities: [
          `Economy weight: ${scenario.objectives.economyWeight}`,
          `Peak reduction weight: ${scenario.objectives.peakWeight}`,
          `Renewable use weight: ${scenario.objectives.renewableWeight}`,
          "When demand management is supplied, avoid charging near the control target and prefer discharge during a predicted exceedance.",
          "Avoid unnecessary cycling when the value difference is small.",
        ],
      },
      actionCriteria,
    );
  }

  const state = asTraceValue({
    site: {
      scenario_name: scenario.name,
      description: scenario.description,
      forecast_resolution: "one hour",
      export_tariff_CNY_per_kWh: scenario.feedInTariffCnyPerKWh,
    },
    observation: measurement ? {
      measured_at: measurement.measuredAt,
      sequence: measurement.sequence,
      load_kW: measurement.values.loadKW,
      solar_kW: measurement.values.solarKW,
      grid_power_kW: measurement.values.gridPowerKW,
      battery_power_kW: measurement.values.batteryPowerKW,
      battery_SOC_percent: measurement.values.batterySocPercent,
      ...(measurement.values.demand15MinKW !== undefined && measurement.values.billingPeakToDateKW !== undefined ? {
        demand_15_min_kW: measurement.values.demand15MinKW,
        billing_peak_to_date_kW: measurement.values.billingPeakToDateKW,
      } : {}),
    } : {
      availability: "No live measurement was supplied; use the scenario initial state.",
    },
    battery: {
      usable_capacity_kWh: scenario.battery.capacityKWh,
      maximum_charge_or_discharge_power_kW: scenario.battery.maxPowerKW,
      initial_SOC_percent: scenario.battery.initialSoc * 100,
      minimum_SOC_percent: scenario.battery.minSoc * 100,
      maximum_SOC_percent: scenario.battery.maxSoc * 100,
      preferred_reserve_SOC_percent: scenario.battery.reserveSoc * 100,
      round_trip_efficiency_percent: scenario.battery.roundTripEfficiency * 100,
    },
    demand_management: scenario.demandManagement ? {
      status: "enabled",
      contracted_demand_kW: scenario.demandManagement.contractedDemandKW,
      control_target_kW: scenario.demandManagement.controlTargetKW,
      demand_charge_CNY_per_kW: scenario.demandManagement.demandChargeCnyPerKW,
      measured_demand_15_min_kW: scenario.demandManagement.measuredDemand15MinKW,
      billing_peak_to_date_kW: scenario.demandManagement.billingPeakToDateKW,
      forecast_meaning: "Each hourly value is the predicted maximum rolling 15-minute demand within that hour before battery action.",
    } : {
      status: "not supplied",
    },
    forecast,
  }) as EntryType;

  const request = {
    model: "jev-latest",
    state,
    questions,
  };

  const response = await client.systemOne(request);

  const answers: Record<string, JevChoiceAnswer> = {};
  const intents = Array.from({ length: 24 }, (_, hour) => {
    const key = `hour_${String(hour).padStart(2, "0")}`;
    const answer = response.answers[key];
    answers[key] = {
      type: "choice",
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: {
        charge: answer.probabilities.charge,
        hold: answer.probabilities.hold,
        discharge: answer.probabilities.discharge,
      },
    };
    return {
      action: answer.choice,
      confidence: answer.confidence,
      probabilities: {
        charge: answer.probabilities.charge,
        hold: answer.probabilities.hold,
        discharge: answer.probabilities.discharge,
      },
    } satisfies JevIntent;
  });

  return {
    intents,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    trace: {
      request: {
        model: request.model,
        state: asTraceValue(request.state),
        questions: asTraceValue(request.questions) as Record<string, JevTraceValue>,
      },
      response: {
        model: response.model,
        answers,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      },
    },
  };
}
