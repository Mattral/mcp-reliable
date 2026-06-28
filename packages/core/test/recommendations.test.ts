import { describe, expect, it } from "vitest";
import { buildRecommendation } from "../src/recommendations.js";

describe("buildRecommendation", () => {
  it("recommends avoid when unreachable, regardless of other signals", () => {
    const result = buildRecommendation({ reachable: false, healthScore: 95, recentHighSeverityDrift: false });
    expect(result.level).toBe("avoid");
    expect(result.reason).toMatch(/unreachable/i);
  });

  it("unreachable outranks even a perfect health score", () => {
    const result = buildRecommendation({ reachable: false, healthScore: 100, recentHighSeverityDrift: false });
    expect(result.level).toBe("avoid");
  });

  it("recommends avoid on a critically degraded health score", () => {
    const result = buildRecommendation({ reachable: true, healthScore: 30, recentHighSeverityDrift: false });
    expect(result.level).toBe("avoid");
    expect(result.reason).toMatch(/critically degraded/i);
  });

  it("recommends caution on a degraded (but not critical) health score", () => {
    const result = buildRecommendation({ reachable: true, healthScore: 65, recentHighSeverityDrift: false });
    expect(result.level).toBe("caution");
    expect(result.reason).toMatch(/degraded/i);
  });

  it("recommends caution on recent high-severity drift with an otherwise healthy score", () => {
    const result = buildRecommendation({ reachable: true, healthScore: 95, recentHighSeverityDrift: true });
    expect(result.level).toBe("caution");
    expect(result.reason).toMatch(/schema or output change/i);
  });

  it("a critical health score outranks drift for the returned reason", () => {
    const result = buildRecommendation({ reachable: true, healthScore: 30, recentHighSeverityDrift: true });
    expect(result.level).toBe("avoid");
    expect(result.reason).toMatch(/critically degraded/i);
  });

  it("recommends unknown when there is no data of either kind yet", () => {
    const result = buildRecommendation({ reachable: null, healthScore: null, recentHighSeverityDrift: false });
    expect(result.level).toBe("unknown");
  });

  it("recommends healthy when reachable, no traffic yet, and no drift", () => {
    const result = buildRecommendation({ reachable: true, healthScore: null, recentHighSeverityDrift: false });
    expect(result.level).toBe("healthy");
  });

  it("recommends healthy when everything looks good", () => {
    const result = buildRecommendation({ reachable: true, healthScore: 98, recentHighSeverityDrift: false });
    expect(result.level).toBe("healthy");
  });

  it("respects custom thresholds", () => {
    const thresholds = { warningBelow: 95, criticalBelow: 90 };
    const result = buildRecommendation({ reachable: true, healthScore: 92, recentHighSeverityDrift: false }, thresholds);
    expect(result.level).toBe("caution");
  });
});
