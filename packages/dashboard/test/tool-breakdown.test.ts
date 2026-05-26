import { describe, expect, it } from "vitest";
import { aggregateByTool, percentile } from "../src/lib/tool-stats.js";
import type { Execution } from "../src/lib/types.js";

function exec(overrides: Partial<Execution> = {}): Execution {
  return {
    id: crypto.randomUUID(),
    serverId: "srv-1",
    toolName: "search",
    startedAt: Date.now(),
    durationMs: 50,
    success: true,
    source: "proxy",
    ...overrides
  };
}

describe("percentile", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 95)).toBe(0);
  });

  it("computes p95 using nearest-rank, matching core's implementation", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(95);
  });
});

describe("aggregateByTool", () => {
  it("returns an empty list when there are no proxy executions", () => {
    expect(aggregateByTool([exec({ source: "health-check", toolName: "__health_check__" })])).toEqual([]);
  });

  it("groups executions by tool name and computes success rate + p95", () => {
    const executions = [
      exec({ toolName: "search", durationMs: 10, success: true }),
      exec({ toolName: "search", durationMs: 20, success: true }),
      exec({ toolName: "search", durationMs: 30, success: false }),
      exec({ toolName: "fetch", durationMs: 100, success: true })
    ];
    const stats = aggregateByTool(executions);
    const search = stats.find((s) => s.name === "search");
    const fetch = stats.find((s) => s.name === "fetch");

    expect(search?.count).toBe(3);
    expect(search?.successRate).toBeCloseTo(2 / 3, 5);
    expect(fetch?.count).toBe(1);
    expect(fetch?.successRate).toBe(1);
  });

  it("ignores health-check executions even when mixed with proxy traffic", () => {
    const executions = [
      exec({ toolName: "search", source: "proxy" }),
      exec({ toolName: "__health_check__", source: "health-check" })
    ];
    const stats = aggregateByTool(executions);
    expect(stats.map((s) => s.name)).toEqual(["search"]);
  });

  it("sorts tools by call count, most frequent first", () => {
    const executions = [
      exec({ toolName: "rare" }),
      exec({ toolName: "common" }),
      exec({ toolName: "common" }),
      exec({ toolName: "common" })
    ];
    const stats = aggregateByTool(executions);
    expect(stats[0]?.name).toBe("common");
    expect(stats[1]?.name).toBe("rare");
  });
});
