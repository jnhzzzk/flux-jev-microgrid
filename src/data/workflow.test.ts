import { describe, expect, it } from "vitest";
import { createScenario } from "./scenarios";
import { buildForecastRequest, buildMeasurementRequest } from "./workflow";

describe("tablet workflow request building", () => {
  it("uses the current measured hour and measured SOC", () => {
    const scenario = createScenario("sunny");
    scenario.battery.initialSoc = 0.537;
    const measuredAt = new Date("2026-09-22T10:15:00+08:00");
    const request = buildMeasurementRequest(scenario, measuredAt, 42);

    expect(request.sequence).toBe(42);
    expect(request.values.loadKW).toBe(scenario.loadKW[10]);
    expect(request.values.solarKW).toBe(scenario.solarKW[10]);
    expect(request.values.batterySocPercent).toBe(53.7);
  });

  it("references the accepted measurement before dispatching a forecast", () => {
    const scenario = createScenario("cloud-drop");
    const request = buildForecastRequest(
      scenario,
      {
        measurementId: "m-accepted",
        siteId: "binhai-microgrid",
        measuredAt: "2026-09-22T02:15:00.000Z",
        receivedAt: "2026-09-22T02:15:00.050Z",
        status: "accepted",
      },
      new Date("2026-09-22T02:15:01.000Z"),
      true,
    );

    expect(request.measurementId).toBe("m-accepted");
    expect(Date.parse(request.forecast.issuedAt)).toBeGreaterThanOrEqual(Date.parse("2026-09-22T02:15:00.000Z"));
    expect(request.forecast.loadKW).toHaveLength(24);
    expect(request.forecast.solarKW).toHaveLength(24);
  });

  it("keeps observed demand in measurement and future demand in forecast", () => {
    const scenario = createScenario("demand-control");
    const measuredAt = new Date("2026-09-22T16:15:00+08:00");
    const measurement = buildMeasurementRequest(scenario, measuredAt, 43);
    const forecast = buildForecastRequest(
      scenario,
      {
        measurementId: "m-demand",
        siteId: "binhai-microgrid",
        measuredAt: measuredAt.toISOString(),
        receivedAt: "2026-09-22T08:15:00.050Z",
        status: "accepted",
      },
      new Date("2026-09-22T08:15:01.000Z"),
      true,
    );

    expect(measurement.values.demand15MinKW).toBe(228);
    expect(measurement.values.billingPeakToDateKW).toBe(238);
    expect(forecast.forecast.demandManagement?.controlTargetKW).toBe(245);
    expect(forecast.forecast.demandManagement?.predictedDemand15MinKW).toHaveLength(24);
  });
});
