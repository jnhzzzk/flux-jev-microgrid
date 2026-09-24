import { describe, expect, it, vi } from "vitest";
import { createScenario } from "./scenarios";
import { createLocalSimulation } from "./localSimulation";

const issuedAt = new Date("2026-09-24T09:15:00.000Z");

describe("local Pages simulation", () => {
  it("returns a reproducible 24-hour rule schedule without Jev trace data", () => {
    const scenario = createScenario("sunny");
    const first = createLocalSimulation(scenario, issuedAt, 42);
    const second = createLocalSimulation(scenario, issuedAt, 42);

    expect(first).toEqual(second);
    expect(first.receipt.measurementId).toBe("sample-m-16");
    expect(first.forecast.useJev).toBe(false);
    expect(first.forecast.forecast.forecastId).toMatch(/^sample-fc-/);
    expect(first.result.schedule).toHaveLength(24);
    expect(first.result.meta.source).toBe("rules");
    expect(first.result.meta.model).toBe("local-rule-simulation");
    expect(first.result.jevTrace).toBeUndefined();
    expect(first.result.meta.warning).toContain("未调用 Jev");
  });

  it("uses the sample SOC as the first dispatch state", () => {
    const scenario = createScenario("cloud-drop");
    scenario.battery.initialSoc = 0.537;

    const simulation = createLocalSimulation(scenario, issuedAt, 43);

    expect(simulation.measurement.values.batterySocPercent).toBe(53.7);
    expect(simulation.result.schedule[0].socBefore).toBe(53.7);
  });

  it("keeps the demand-management peak response in the local rules", () => {
    const scenario = createScenario("demand-control");
    scenario.battery.initialSoc = scenario.battery.maxSoc;
    const simulation = createLocalSimulation(scenario, issuedAt, 44);
    const target = scenario.demandManagement!.controlTargetKW;
    const hour = scenario.demandManagement!.predictedDemand15MinKW.findIndex(
      (value) => value > target,
    );

    expect(simulation.result.schedule[hour].action).toBe("discharge");
    expect(simulation.result.schedule[hour].batteryPowerKW).toBeGreaterThan(0);
  });

  it("does not issue browser or API requests", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    createLocalSimulation(createScenario("sunny"), issuedAt, 45);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
