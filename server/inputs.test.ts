import { describe, expect, it } from "vitest";
import type {
  ForecastDispatchRequest,
  MeasurementIngestRequest,
} from "../shared/contracts";
import { acceptMeasurement, buildScenarioFromForecast } from "./inputs";

const measurement: MeasurementIngestRequest = {
  siteId: "binhai-microgrid",
  measuredAt: "2026-09-22T12:00:00+08:00",
  sequence: 18421,
  values: {
    loadKW: 149,
    solarKW: 205,
    gridPowerKW: -56,
    batteryPowerKW: 0,
    batterySocPercent: 46,
  },
};

function forecastRequest(measurementId: string): ForecastDispatchRequest {
  return {
    siteId: "binhai-microgrid",
    measurementId,
    useJev: true,
    forecast: {
      forecastId: "fc-20260922-1205",
      issuedAt: "2026-09-22T12:05:00+08:00",
      horizonStart: "2026-09-22T13:00:00+08:00",
      resolutionMinutes: 60,
      loadKW: Array.from({ length: 24 }, (_, hour) => 120 + hour),
      solarKW: Array.from({ length: 24 }, (_, hour) => Math.max(0, 180 - hour * 9)),
      tariffCnyPerKWh: Array.from({ length: 24 }, () => 0.52),
    },
  };
}

describe("staged production inputs", () => {
  it("accepts measurement first and uses its SOC as the forecast baseline", () => {
    const { stored, receipt } = acceptMeasurement(
      measurement,
      new Date("2026-09-22T04:00:01.000Z"),
    );
    const request = forecastRequest(receipt.measurementId);
    const scenario = buildScenarioFromForecast(stored, request);

    expect(receipt.status).toBe("accepted");
    expect(receipt.measurementId).toMatch(/^m-/);
    expect(scenario.battery.initialSoc).toBe(0.46);
    expect(scenario.loadKW).toEqual(request.forecast.loadKW);
  });

  it("rejects a forecast that predates its referenced measurement", () => {
    const { stored, receipt } = acceptMeasurement(measurement);
    const request = forecastRequest(receipt.measurementId);
    request.forecast.issuedAt = "2026-09-22T11:59:00+08:00";

    expect(() => buildScenarioFromForecast(stored, request)).toThrow(
      "预测发布时间不能早于所引用的量测时间",
    );
  });

  it("combines measured demand with the later demand forecast", () => {
    const demandMeasurement: MeasurementIngestRequest = {
      ...measurement,
      values: {
        ...measurement.values,
        demand15MinKW: 228,
        billingPeakToDateKW: 238,
      },
    };
    const { stored, receipt } = acceptMeasurement(demandMeasurement);
    const request = forecastRequest(receipt.measurementId);
    request.forecast.demandManagement = {
      contractedDemandKW: 300,
      controlTargetKW: 245,
      demandChargeCnyPerKW: 46,
      predictedDemand15MinKW: Array.from({ length: 24 }, (_, hour) => 220 + hour * 3),
    };

    const scenario = buildScenarioFromForecast(stored, request);

    expect(scenario.demandManagement?.measuredDemand15MinKW).toBe(228);
    expect(scenario.demandManagement?.billingPeakToDateKW).toBe(238);
    expect(scenario.demandManagement?.predictedDemand15MinKW).toEqual(
      request.forecast.demandManagement.predictedDemand15MinKW,
    );
  });
});
