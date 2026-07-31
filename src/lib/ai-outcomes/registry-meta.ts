import type { AiOutcomeMeta } from "./types";

/** Client-safe metadata for every registered outcome type — deliberately does
 *  NOT import from the outcome modules themselves (e.g. route-to-togra.ts),
 *  even though that would remove the string-literal duplication below. Those
 *  modules are free to pull in server-only dependencies (a future outcome
 *  type's LLM provider call, for instance), and this file is imported by
 *  client components like AiQueueSettingsModal — importing from them here
 *  would risk silently bundling that into the browser. Keep in sync with
 *  registry.ts — one entry per AiOutcomeDefinition (registry.ts asserts this
 *  in development). */
export const AI_OUTCOME_META: AiOutcomeMeta[] = [
  { type: "route_to_togra", label: "Auto-route to Togra", defaultConfidenceThreshold: 0.7 },
  { type: "flag_duplicate", label: "Flag possible duplicate", defaultConfidenceThreshold: 0.6 },
];
