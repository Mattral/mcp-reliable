import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEALTH_DEGRADATION_THRESHOLDS,
  detectHealthDegradation,
  driftEventToAlert
} from "../src/alerts.js";
import type { DriftEvent, HealthScore } from "../src/types.js";

function driftEvent(overrides: Partial<DriftEvent> = {}): DriftEvent {
  return {
    id: "drift-1",
    serverId: "srv-1",
    toolName: "search",
    detectedAt: 1000,
    kind: "schema",
    severity: "high",
    description: "schema changed",
    ...overrides
  };
}

function healthScore(overrides: Partial<HealthScore> = {}): HealthScore {
  return {
    serverId: "srv-1",
    windowStart: 0,
    windowEnd: 1000,
    score: 100,
    successRate: 1,
    p50LatencyMs: 10,
    p95LatencyMs: 20,
    errorRate: 0,
    sampleCount: 10,
    ...overrides
  };
}

describe("driftEventToAlert", () => {
  it("maps drift severity to alert severity on the same low/medium/high -> info/warning/critical scale", () => {
    expect(driftEventToAlert(driftEvent({ severity: "low" })).severity).toBe("info");
    expect(driftEventToAlert(driftEvent({ severity: "medium" })).severity).toBe("warning");
    expect(driftEventToAlert(driftEvent({ severity: "high" })).severity).toBe("critical");
  });

  it("carries the server id and description through", () => {
    const alert = driftEventToAlert(driftEvent({ serverId: "srv-42", description: "add tool schema changed" }));
    expect(alert.serverId).toBe("srv-42");
    expect(alert.message).toBe("add tool schema changed");
    expect(alert.kind).toBe("drift");
  });
});

describe("detectHealthDegradation", () => {
  it("returns null when there is no data in the current window", () => {
    const result = detectHealthDegradation("srv-1", 90, healthScore({ sampleCount: 0 }));
    expect(result).toBeNull();
  });

  it("returns null when the server is healthy, regardless of previous score", () => {
    expect(detectHealthDegradation("srv-1", 40, healthScore({ score: 95 }))).toBeNull();
    expect(detectHealthDegradation("srv-1", undefined, healthScore({ score: 95 }))).toBeNull();
  });

  it("alerts at warning severity on first transition into the warning band", () => {
    const alert = detectHealthDegradation("srv-1", 90, healthScore({ score: 65 }));
    expect(alert).not.toBeNull();
    expect(alert?.severity).toBe("warning");
    expect(alert?.kind).toBe("health-degradation");
  });

  it("alerts at critical severity on first transition into the critical band", () => {
    const alert = detectHealthDegradation("srv-1", 90, healthScore({ score: 30 }));
    expect(alert?.severity).toBe("critical");
  });

  it("treats no previous score as a healthy baseline (still alerts if currently degraded)", () => {
    const alert = detectHealthDegradation("srv-1", undefined, healthScore({ score: 40 }));
    expect(alert).not.toBeNull();
    expect(alert?.severity).toBe("critical");
  });

  it("does not re-alert when the band is unchanged from the previous check", () => {
    // Both previous (65) and current (60) are in the warning band.
    expect(detectHealthDegradation("srv-1", 65, healthScore({ score: 60 }))).toBeNull();
  });

  it("alerts again when degradation worsens from warning to critical", () => {
    const alert = detectHealthDegradation("srv-1", 65, healthScore({ score: 30 }));
    expect(alert?.severity).toBe("critical");
  });

  it("does not alert when improving but still within the same degraded band", () => {
    // 55 -> 60 is warning -> warning, an improvement but not a band change.
    expect(detectHealthDegradation("srv-1", 55, healthScore({ score: 60 }))).toBeNull();
  });

  it("respects custom thresholds", () => {
    const thresholds = { warningBelow: 90, criticalBelow: 80 };
    const alert = detectHealthDegradation("srv-1", 95, healthScore({ score: 85 }), thresholds);
    expect(alert?.severity).toBe("warning");
    expect(DEFAULT_HEALTH_DEGRADATION_THRESHOLDS.warningBelow).toBe(70); // defaults unaffected by the override above
  });
});
