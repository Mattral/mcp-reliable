import { describe, expect, it } from "vitest";
import { detectLatencyDrift, detectOutputShapeDrift, detectSchemaDrift } from "../src/drift.js";
import { computeOutputSignature } from "../src/fingerprint.js";
import type { Execution } from "../src/types.js";

function exec(outputSignature: string, success = true): Execution {
  return {
    id: crypto.randomUUID(),
    serverId: "srv-1",
    toolName: "search",
    startedAt: Date.now(),
    durationMs: 50,
    success,
    outputSignature,
    source: "proxy"
  };
}

function execWithDuration(durationMs: number, success = true): Execution {
  return {
    id: crypto.randomUUID(),
    serverId: "srv-1",
    toolName: "search",
    startedAt: Date.now(),
    durationMs,
    success,
    source: "proxy"
  };
}

/**
 * A deterministic (not `Math.random()`-based) spread of `count` latencies
 * around `base`, cycling through offsets in `[-spread/2, spread/2)` —
 * varied enough to look like real traffic, exactly reproducible.
 */
function latencies(base: number, spread: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => base + ((i * 7) % spread) - Math.floor(spread / 2));
}

describe("detectSchemaDrift", () => {
  it("returns null when there is no previous fingerprint (first observation)", () => {
    expect(
      detectSchemaDrift({
        serverId: "s",
        toolName: "search",
        previousFingerprint: undefined,
        currentFingerprint: "abc"
      })
    ).toBeNull();
  });

  it("returns null when the fingerprint is unchanged", () => {
    expect(
      detectSchemaDrift({
        serverId: "s",
        toolName: "search",
        previousFingerprint: "abc",
        currentFingerprint: "abc"
      })
    ).toBeNull();
  });

  it("returns a high-severity DriftEvent when the fingerprint changes", () => {
    const event = detectSchemaDrift({
      serverId: "s",
      toolName: "search",
      previousFingerprint: "abc",
      currentFingerprint: "def"
    });
    expect(event).not.toBeNull();
    expect(event?.kind).toBe("schema");
    expect(event?.severity).toBe("high");
    expect(event?.previousValue).toBe("abc");
    expect(event?.newValue).toBe("def");
  });
});

describe("detectOutputShapeDrift", () => {
  const shapeA = computeOutputSignature({ status: "ok", items: [] });
  const shapeB = computeOutputSignature({ status: "ok", items: [], extra: true });

  it("returns null when either window has too few samples", () => {
    const baseline = Array.from({ length: 2 }, () => exec(shapeA));
    const recent = Array.from({ length: 10 }, () => exec(shapeB));
    expect(detectOutputShapeDrift({ serverId: "s", toolName: "search", baseline, recent })).toBeNull();
  });

  it("returns null when the dominant shape is unchanged", () => {
    const baseline = Array.from({ length: 10 }, () => exec(shapeA));
    const recent = Array.from({ length: 10 }, () => exec(shapeA));
    expect(detectOutputShapeDrift({ serverId: "s", toolName: "search", baseline, recent })).toBeNull();
  });

  it("returns null when recent calls are too mixed to be confident (below minDominance)", () => {
    const baseline = Array.from({ length: 10 }, () => exec(shapeA));
    // 50/50 split between old and new shape - not dominant enough by default (0.6)
    const recent = [
      ...Array.from({ length: 5 }, () => exec(shapeA)),
      ...Array.from({ length: 5 }, () => exec(shapeB))
    ];
    expect(detectOutputShapeDrift({ serverId: "s", toolName: "search", baseline, recent })).toBeNull();
  });

  it("flags drift when a new shape dominates recent calls", () => {
    const baseline = Array.from({ length: 10 }, () => exec(shapeA));
    const recent = [
      ...Array.from({ length: 9 }, () => exec(shapeB)),
      ...Array.from({ length: 1 }, () => exec(shapeA))
    ];
    const event = detectOutputShapeDrift({ serverId: "s", toolName: "search", baseline, recent });
    expect(event).not.toBeNull();
    expect(event?.kind).toBe("output-shape");
    expect(event?.severity).toBe("high"); // 9/10 = 0.9 ratio
    expect(event?.previousValue).toBe(shapeA);
    expect(event?.newValue).toBe(shapeB);
  });

  it("ignores failed executions and those without a recorded signature", () => {
    const baseline = Array.from({ length: 10 }, () => exec(shapeA));
    const recent = [
      ...Array.from({ length: 8 }, () => exec(shapeB)),
      ...Array.from({ length: 5 }, () => exec("", false)) // failures shouldn't count toward the total
    ];
    const event = detectOutputShapeDrift({ serverId: "s", toolName: "search", baseline, recent });
    expect(event).not.toBeNull();
    expect(event?.newValue).toBe(shapeB);
  });
});

describe("detectLatencyDrift", () => {
  it("returns null when either window has too few successful executions", () => {
    const baseline = latencies(100, 20, 10).map((d) => execWithDuration(d)); // below default minSampleSize 20
    const recent = latencies(100, 20, 25).map((d) => execWithDuration(d));
    expect(detectLatencyDrift({ serverId: "s", toolName: "search", baseline, recent })).toBeNull();
  });

  it("returns null when the latency distribution hasn't meaningfully changed", () => {
    const baseline = latencies(100, 20, 25).map((d) => execWithDuration(d));
    const recent = latencies(100, 20, 25).map((d) => execWithDuration(d));
    expect(detectLatencyDrift({ serverId: "s", toolName: "search", baseline, recent })).toBeNull();
  });

  it("returns null for a shift below minRelativeShift, even if the KS test finds it significant", () => {
    const baseline = latencies(100, 10, 25).map((d) => execWithDuration(d));
    const recent = latencies(105, 10, 25).map((d) => execWithDuration(d)); // ~5% shift, below the 20% default floor
    expect(detectLatencyDrift({ serverId: "s", toolName: "search", baseline, recent })).toBeNull();
  });

  it("flags drift when latency has gotten durably slower", () => {
    const baseline = latencies(100, 20, 25).map((d) => execWithDuration(d));
    const recent = latencies(250, 20, 25).map((d) => execWithDuration(d));
    const event = detectLatencyDrift({ serverId: "s", toolName: "search", baseline, recent });
    expect(event).not.toBeNull();
    expect(event?.kind).toBe("statistical");
    expect(event?.metric).toBe("latency");
    expect(event?.severity).toBe("high");
    expect(event?.description).toContain("slower");
    expect(event?.previousValue).toMatch(/median=\d+ms, n=25/);
    expect(event?.newValue).toMatch(/median=\d+ms, n=25/);
  });

  it("flags drift when latency has gotten durably faster, in the opposite direction", () => {
    const baseline = latencies(250, 20, 25).map((d) => execWithDuration(d));
    const recent = latencies(100, 20, 25).map((d) => execWithDuration(d));
    const event = detectLatencyDrift({ serverId: "s", toolName: "search", baseline, recent });
    expect(event).not.toBeNull();
    expect(event?.description).toContain("faster");
  });

  it("ignores failed executions when comparing latency", () => {
    const baseline = [
      ...latencies(100, 20, 25).map((d) => execWithDuration(d)),
      ...latencies(9999, 5, 10).map((d) => execWithDuration(d, false)) // wildly different, but failed - shouldn't count
    ];
    const recent = latencies(100, 20, 25).map((d) => execWithDuration(d));
    expect(detectLatencyDrift({ serverId: "s", toolName: "search", baseline, recent })).toBeNull();
  });

  it("respects a stricter minSampleSize override even when the shift is dramatic", () => {
    const baseline = latencies(100, 20, 25).map((d) => execWithDuration(d));
    const recent = latencies(400, 20, 25).map((d) => execWithDuration(d));
    expect(
      detectLatencyDrift({ serverId: "s", toolName: "search", baseline, recent, minSampleSize: 30 })
    ).toBeNull();
  });

  it("respects a looser minRelativeShift override, flagging a shift the default floor would ignore", () => {
    const baseline = latencies(100, 10, 25).map((d) => execWithDuration(d));
    const recent = latencies(108, 10, 25).map((d) => execWithDuration(d)); // ~8% shift
    expect(detectLatencyDrift({ serverId: "s", toolName: "search", baseline, recent })).toBeNull();
    const event = detectLatencyDrift({
      serverId: "s",
      toolName: "search",
      baseline,
      recent,
      minRelativeShift: 0.05
    });
    expect(event).not.toBeNull();
  });
});
