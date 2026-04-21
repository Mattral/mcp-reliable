import { describe, expect, it } from "vitest";
import { formatMs, formatPercent, parseDuration } from "../src/format.js";

describe("parseDuration", () => {
  it("parses simple single-unit durations", () => {
    expect(parseDuration("24h")).toBe(24 * 3_600_000);
    expect(parseDuration("7d")).toBe(7 * 86_400_000);
    expect(parseDuration("30m")).toBe(30 * 60_000);
    expect(parseDuration("45s")).toBe(45 * 1000);
  });

  it("parses combined durations", () => {
    expect(parseDuration("1d12h")).toBe(86_400_000 + 12 * 3_600_000);
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(parseDuration(" 24H ")).toBe(24 * 3_600_000);
  });

  it("throws a descriptive error for unparseable input", () => {
    expect(() => parseDuration("banana")).toThrow(/Could not parse duration/);
    expect(() => parseDuration("")).toThrow();
  });

  it("throws for a zero duration", () => {
    expect(() => parseDuration("0s")).toThrow();
  });
});

describe("formatMs", () => {
  it("shows milliseconds for durations under 1s", () => {
    expect(formatMs(999)).toBe("999ms");
    expect(formatMs(0)).toBe("0ms");
  });

  it("shows seconds for durations of 1s or more", () => {
    expect(formatMs(1000)).toBe("1.00s");
    expect(formatMs(1500)).toBe("1.50s");
  });
});

describe("formatPercent", () => {
  it("formats a 0..1 ratio as a percentage with one decimal place", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(0)).toBe("0.0%");
  });
});
