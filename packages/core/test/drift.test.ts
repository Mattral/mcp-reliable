import { describe, expect, it } from "vitest";
import { detectOutputShapeDrift, detectSchemaDrift } from "../src/drift.js";
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
