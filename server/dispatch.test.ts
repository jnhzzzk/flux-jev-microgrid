import { describe, expect, it } from "vitest";
import { createScenario } from "../src/data/scenarios";
import { deriveRuleIntents, runDispatch } from "./dispatch";
import type { JevIntent } from "./jev";

describe("microgrid dispatch engine", () => {
  it("keeps power and SOC inside hard limits", () => {
    const scenario = createScenario("sunny");
    const result = runDispatch(scenario, deriveRuleIntents(scenario));

    for (const hour of result.schedule) {
      expect(Math.abs(hour.batteryPowerKW)).toBeLessThanOrEqual(
        scenario.battery.maxPowerKW + 0.01,
      );
      expect(hour.socAfter).toBeGreaterThanOrEqual(scenario.battery.minSoc * 100 - 0.1);
      expect(hour.socAfter).toBeLessThanOrEqual(scenario.battery.maxSoc * 100 + 0.1);
    }
  });

  it("preserves the hourly AC energy balance", () => {
    const scenario = createScenario("cloud-drop");
    const result = runDispatch(scenario, deriveRuleIntents(scenario));

    for (const hour of result.schedule) {
      expect(hour.gridPowerKW).toBeCloseTo(
        hour.loadKW - hour.solarKW - hour.batteryPowerKW,
        1,
      );
    }
  });

  it("charges in a valley and discharges in the evening peak", () => {
    const scenario = createScenario("evening-peak");
    const result = runDispatch(scenario, deriveRuleIntents(scenario));
    expect(result.schedule.some((hour) => hour.batteryPowerKW < -0.1)).toBe(true);
    expect(
      result.schedule.slice(17, 22).some((hour) => hour.batteryPowerKW > 0.1),
    ).toBe(true);
  });

  it("turns a predicted 15-minute demand exceedance into the same discharge output", () => {
    const scenario = createScenario("demand-control");
    scenario.battery.initialSoc = scenario.battery.maxSoc;
    const chargeIntent: JevIntent = {
      action: "charge",
      confidence: 0.9,
      probabilities: { charge: 0.9, hold: 0.06, discharge: 0.04 },
    };
    const result = runDispatch(
      scenario,
      Array.from({ length: 24 }, () => ({ ...chargeIntent, probabilities: { ...chargeIntent.probabilities } })),
    );
    const target = scenario.demandManagement!.controlTargetKW;
    const firstExceedance = scenario.demandManagement!.predictedDemand15MinKW.findIndex(
      (value) => value > target,
    );
    const hour = result.schedule[firstExceedance];

    expect(hour.action).toBe("discharge");
    expect(hour.batteryPowerKW).toBeGreaterThan(0);
    expect(hour.rationale).toContain("15 分钟需量");
    expect(hour.constraint).toContain("需量目标");
  });
});
