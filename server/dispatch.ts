import type { DispatchResponse, MicrogridScenario } from "../shared/contracts.js";
import {
  deriveRuleIntents as deriveRuleIntentsImpl,
  runDispatch as runDispatchImpl,
  validateScenario,
} from "../shared/deterministicDispatch.js";
import type { JevIntent } from "./jev.js";

export { validateScenario };
export type { DispatchIntent } from "../shared/deterministicDispatch.js";

/**
 * Server compatibility adapter. The deterministic rule output has the same
 * shape as a Jev intent, while remaining shareable with the static UI build.
 */
export function deriveRuleIntents(scenario: MicrogridScenario): JevIntent[] {
  return deriveRuleIntentsImpl(scenario);
}

/**
 * Server compatibility adapter for deterministic dispatch constraints.
 */
export function runDispatch(
  scenario: MicrogridScenario,
  intents: JevIntent[],
): Omit<DispatchResponse, "meta"> {
  return runDispatchImpl(scenario, intents);
}
