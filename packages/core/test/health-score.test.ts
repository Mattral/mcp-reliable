import { describe, expect, it } from "vitest";
import { computeHealthScore, DEFAULT_HEALTH_SCORE_WEIGHTS } from "../src/health-score.js";
import type { DriftEvent, Execution } from "../src/types.js";

function exec(overrides: Partial<Execution> = {}): Execution {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    serverId: "srv-1",
    toolName: "search",
    startedAt: Date.now(),
    durationMs: 100,
    success: true,
    source: "proxy",
    ...overrides
  };
}

describe("computeHealthScore", () => {
  it("returns a 0 score with 0 sample count for an empty window", () => {
    const result = computeHealthScore({
      serverId: "srv-1",
      windowStart: 0,
      windowEnd: 1000,
      executions: []
    });
    expect(result.sampleCount).toBe(0);
    expect(result.score).toBe(0);
  });

  it("scores a perfectly reliable, fast server at 100", () => {
    const executions = Array.from({ length: 20 }, () => exec({ durationMs: 50, success: true }));
    const result = computeHealthScore({
      serverId: "srv-1",
      windowStart: 0,
      windowEnd: 1000,
      executions
    });
    expect(result.score).toBeCloseTo(100, 5);
    expect(result.successRate).toBe(1);
    expect(result.errorRate).toBe(0);
  });

  it("scores a completely failing server at 0 even if fast", () => {
    const executions = Array.from({ length: 20 }, () => exec({ durationMs: 10, success: false }));
    const result = computeHealthScore({
      serverId: "srv-1",
      windowStart: 0,
      windowEnd: 1000,
      executions
    });
    expect(result.score).toBe(0);
    expect(result.successRate).toBe(0);
  });

  it("penalizes high latency even when every call succeeds", () => {
    const fast = Array.from({ length: 20 }, () => exec({ durationMs: 50, success: true }));
    const slow = Array.from({ length: 20 }, () => exec({ durationMs: 8000, success: true }));

    const fastScore = computeHealthScore({ serverId: "s", windowStart: 0, windowEnd: 1, executions: fast }).score;
    const slowScore = computeHealthScore({ serverId: "s", windowStart: 0, windowEnd: 1, executions: slow }).score;

    expect(slowScore).toBeLessThan(fastScore);
    // successWeight alone (0.65) still guarantees a floor, since latencyScore is clamped at 0.
    expect(slowScore).toBeCloseTo(100 * DEFAULT_HEALTH_SCORE_WEIGHTS.successWeight, 5);
  });

  it("gates the score by success rate: 50% failure caps the ceiling at 50, even with perfect latency", () => {
    const halfFailingButFast = Array.from({ length: 20 }, (_, i) =>
      exec({ durationMs: 50, success: i % 2 === 0 })
    );
    const result = computeHealthScore({
      serverId: "s",
      windowStart: 0,
      windowEnd: 1,
      executions: halfFailingButFast
    });
    // successRate=0.5 multiplicatively gates the score: 100 * 0.5 * (0.65 + 0.35*1) = 50.
    expect(result.score).toBeCloseTo(50, 5);
  });

  it("subtracts drift penalties, capped at maxDriftPenalty", () => {
    const executions = Array.from({ length: 20 }, () => exec({ durationMs: 50, success: true }));
    const manyHighDrift: DriftEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`,
      serverId: "s",
      toolName: "search",
      detectedAt: Date.now(),
      kind: "schema",
      severity: "high",
      description: "changed"
    }));

    const result = computeHealthScore({
      serverId: "s",
      windowStart: 0,
      windowEnd: 1,
      executions,
      driftEvents: manyHighDrift
    });

    // 10 high-severity events * 15 points = 150, capped at maxDriftPenalty (30).
    expect(result.score).toBeCloseTo(100 - DEFAULT_HEALTH_SCORE_WEIGHTS.maxDriftPenalty, 5);
  });

  it("never returns a score outside [0, 100]", () => {
    const executions = Array.from({ length: 5 }, () => exec({ durationMs: 50, success: true }));
    const extremeDrift: DriftEvent[] = Array.from({ length: 50 }, (_, i) => ({
      id: `d${i}`,
      serverId: "s",
      toolName: "search",
      detectedAt: Date.now(),
      kind: "schema",
      severity: "high",
      description: "changed"
    }));
    const result = computeHealthScore({
      serverId: "s",
      windowStart: 0,
      windowEnd: 1,
      executions,
      driftEvents: extremeDrift
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("computes correct p50/p95 latency alongside the score", () => {
    const durations = Array.from({ length: 100 }, (_, i) => i + 1);
    const executions = durations.map((d) => exec({ durationMs: d, success: true }));
    const result = computeHealthScore({ serverId: "s", windowStart: 0, windowEnd: 1, executions });
    expect(result.p50LatencyMs).toBe(50);
    expect(result.p95LatencyMs).toBe(95);
  });
});
