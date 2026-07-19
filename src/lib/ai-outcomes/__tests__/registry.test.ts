import { AI_OUTCOME_REGISTRY, getOutcomeDefinition } from "../registry";
import { AI_OUTCOME_META } from "../registry-meta";
import { ROUTE_TO_TOGRA_TYPE } from "../route-to-togra";

describe("AI_OUTCOME_REGISTRY", () => {
  it("registers route_to_togra", () => {
    expect(AI_OUTCOME_REGISTRY.map((o) => o.type)).toContain(ROUTE_TO_TOGRA_TYPE);
  });

  it("has a registry-meta entry for every registered outcome type", () => {
    const metaTypes = new Set(AI_OUTCOME_META.map((m) => m.type));
    for (const def of AI_OUTCOME_REGISTRY) {
      expect(metaTypes.has(def.type)).toBe(true);
    }
  });

  it("has a registered definition for every registry-meta entry", () => {
    const defTypes = new Set(AI_OUTCOME_REGISTRY.map((d) => d.type));
    for (const meta of AI_OUTCOME_META) {
      expect(defTypes.has(meta.type)).toBe(true);
    }
  });
});

describe("getOutcomeDefinition", () => {
  it("returns the definition for a known type", () => {
    expect(getOutcomeDefinition(ROUTE_TO_TOGRA_TYPE)?.type).toBe(ROUTE_TO_TOGRA_TYPE);
  });

  it("returns undefined for an unknown type", () => {
    expect(getOutcomeDefinition("not_a_real_outcome_type")).toBeUndefined();
  });
});
