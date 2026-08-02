import { describe, expect, it } from "vitest";
import { classifyError, summarizeErrorCategories } from "../src/error-classification.js";
import type { Execution } from "../src/types.js";

function exec(overrides: Partial<Execution> = {}): Execution {
  return {
    id: crypto.randomUUID(),
    serverId: "srv-1",
    toolName: "search",
    startedAt: Date.now(),
    durationMs: 50,
    success: false,
    source: "proxy",
    ...overrides
  };
}

describe("classifyError", () => {
  it.each([
    ["rate-limit", "Rate limit exceeded, please slow down"],
    ["rate-limit", "429 Too Many Requests"],
    ["auth", "401 Unauthorized"],
    ["auth", "Invalid API key provided"],
    ["not-found", "Tool 'search' not found on this server"],
    ["not-found", "404: no such resource"],
    ["timeout", "MCP error -32001: Request timed out"],
    ["timeout", "connect ETIMEDOUT 10.0.0.1:443"],
    ["validation", "Invalid input: 'query' is required but missing"],
    ["validation", "400 Bad Request"],
    ["connection", "connect ECONNREFUSED 127.0.0.1:5000"],
    ["connection", "socket hang up"],
    ["server-error", "500 Internal Server Error"],
    ["unknown", "the flux capacitor exploded"],
    ["unknown", "simulated transient failure"]
  ] as const)("classifies %s from %j", (expected, message) => {
    expect(classifyError(message)).toBe(expected);
  });

  it("checks rate-limit before auth, so a 429 isn't misread as a generic 4xx auth issue", () => {
    expect(classifyError("429: rate limit exceeded, try again later")).toBe("rate-limit");
  });
});

describe("summarizeErrorCategories", () => {
  it("returns an empty array when there are no failures", () => {
    const executions = [exec({ success: true }), exec({ success: true })];
    expect(summarizeErrorCategories(executions)).toEqual([]);
  });

  it("excludes failures with no recorded errorMessage", () => {
    const executions = [exec({ success: false, errorMessage: undefined })];
    expect(summarizeErrorCategories(executions)).toEqual([]);
  });

  it("excludes successful executions even if they somehow carry an errorMessage", () => {
    const executions = [exec({ success: true, errorMessage: "should be ignored" })];
    expect(summarizeErrorCategories(executions)).toEqual([]);
  });

  it("groups by category, sorted by count descending, with ratios summing to 1", () => {
    const executions = [
      exec({ errorMessage: "429 Too Many Requests" }),
      exec({ errorMessage: "429 Too Many Requests" }),
      exec({ errorMessage: "rate limit hit" }),
      exec({ errorMessage: "401 Unauthorized" })
    ];
    const summary = summarizeErrorCategories(executions);
    expect(summary).toHaveLength(2);
    expect(summary[0]?.category).toBe("rate-limit");
    expect(summary[0]?.count).toBe(3);
    expect(summary[0]?.ratio).toBeCloseTo(0.75);
    expect(summary[1]?.category).toBe("auth");
    expect(summary[1]?.count).toBe(1);
    expect(summary[1]?.ratio).toBeCloseTo(0.25);
    expect(summary.reduce((sum, s) => sum + s.ratio, 0)).toBeCloseTo(1);
  });

  it("includes a real example message per category", () => {
    const executions = [exec({ errorMessage: "simulated transient failure" })];
    const summary = summarizeErrorCategories(executions);
    expect(summary[0]?.exampleMessage).toBe("simulated transient failure");
  });
});
