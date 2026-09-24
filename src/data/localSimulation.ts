import type {
  DispatchResponse,
  ForecastDispatchRequest,
  MeasurementIngestRequest,
  MeasurementReceipt,
  MicrogridScenario,
} from "../../shared/contracts";
import { deriveRuleIntents, runDispatch } from "../../shared/deterministicDispatch";
import { buildForecastRequest, buildMeasurementRequest } from "./workflow";

export const LOCAL_SIMULATION_WARNING = "本地仿真：使用内置样本与确定性约束计算；未调用 Jev、未连接现场设备，也不会控制设备。";

export interface LocalSimulationRun {
  measurement: MeasurementIngestRequest;
  receipt: MeasurementReceipt;
  forecast: ForecastDispatchRequest;
  result: DispatchResponse;
}

/**
 * Generates a browser-only walkthrough for the static Pages build. This is
 * deliberately pure: it neither receives a key nor makes a network request.
 */
export function createLocalSimulation(
  scenario: MicrogridScenario,
  issuedAt: Date,
  sequence: number,
): LocalSimulationRun {
  const measurement = buildMeasurementRequest(scenario, issuedAt, sequence);
  const receipt: MeasurementReceipt = {
    measurementId: `sample-m-${sequence.toString(36)}`,
    siteId: measurement.siteId,
    measuredAt: measurement.measuredAt,
    receivedAt: issuedAt.toISOString(),
    status: "accepted",
  };
  const baseForecast = buildForecastRequest(scenario, receipt, issuedAt, false);
  const forecast: ForecastDispatchRequest = {
    ...baseForecast,
    forecast: {
      ...baseForecast.forecast,
      forecastId: `sample-${baseForecast.forecast.forecastId}`,
    },
  };
  const dispatchScenario: MicrogridScenario = {
    ...scenario,
    battery: {
      ...scenario.battery,
      initialSoc: measurement.values.batterySocPercent / 100,
    },
  };
  const { schedule, summary } = runDispatch(
    dispatchScenario,
    deriveRuleIntents(dispatchScenario),
  );

  return {
    measurement,
    receipt,
    forecast,
    result: {
      schedule,
      summary,
      meta: {
        source: "rules",
        model: "local-rule-simulation",
        generatedAt: issuedAt.toISOString(),
        latencyMs: 0,
        measurementId: receipt.measurementId,
        forecastId: forecast.forecast.forecastId,
        warning: LOCAL_SIMULATION_WARNING,
      },
    },
  };
}
