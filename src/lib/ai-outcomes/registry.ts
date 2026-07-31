import { routeToTogra } from "./route-to-togra";
import { flagDuplicate } from "./flag-duplicate";
import { AI_OUTCOME_META } from "./registry-meta";
import type { AiOutcomeDefinition } from "./types";

/** Every registered AI-triage outcome type. Adding a new one means writing a
 *  new file implementing AiOutcomeDefinition and adding it here, plus a
 *  matching entry in registry-meta.ts — nothing else in the triage route,
 *  queue settings UI, or feedback UI needs to change. */
export const AI_OUTCOME_REGISTRY: AiOutcomeDefinition[] = [routeToTogra, flagDuplicate];

export function getOutcomeDefinition(type: string): AiOutcomeDefinition | undefined {
  return AI_OUTCOME_REGISTRY.find((o) => o.type === type);
}

if (process.env.NODE_ENV !== "production") {
  const metaTypes = new Set(AI_OUTCOME_META.map((m) => m.type));
  for (const def of AI_OUTCOME_REGISTRY) {
    if (!metaTypes.has(def.type)) {
      throw new Error(
        `ai-outcomes: "${def.type}" is registered in registry.ts but missing from registry-meta.ts`
      );
    }
  }
}
