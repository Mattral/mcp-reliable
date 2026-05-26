import { describe, expect, it } from "vitest";
import { classifyScore, formatMs, formatPercent, formatRelativeTime, scoreTextClass, severityTextClass } from "../src/lib/format.js";

describe("classifyScore", () => {
  it("matches the CLI's thresholds: >=90 good, >=70 warn, else bad", () => {
    expect(classifyScore(100)).toBe("good");
    expect(classifyScore(90)).toBe("good");
    expect(classifyScore(89.9)).toBe("warn");
    expect(classifyScore(70)).toBe("warn");
    expect(classifyScore(69.9)).toBe("bad");
    expect(classifyScore(0)).toBe("bad");
  });
});

describe("scoreTextClass", () => {
  it("returns the matching Tailwind color class for each band", () => {
    expect(scoreTextClass(95)).toBe("text-good");
    expect(scoreTextClass(80)).toBe("text-warn");
    expect(scoreTextClass(20)).toBe("text-bad");
  });
});

describe("severityTextClass", () => {
  it("maps known severities to a color class", () => {
    expect(severityTextClass("high")).toBe("text-bad");
    expect(severityTextClass("critical")).toBe("text-bad");
    expect(severityTextClass("medium")).toBe("text-warn");
    expect(severityTextClass("low")).toBe("text-text-muted");
  });

  it("falls back gracefully for an unknown severity", () => {
    expect(severityTextClass("unknown-severity")).toBe("text-text-primary");
  });
});

describe("formatMs", () => {
  it("shows milliseconds under 1s, seconds at/above 1s", () => {
    expect(formatMs(999)).toBe("999ms");
    expect(formatMs(1000)).toBe("1.00s");
    expect(formatMs(1500)).toBe("1.50s");
  });
});

describe("formatPercent", () => {
  it("formats a 0..1 ratio with one decimal place", () => {
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(1)).toBe("100.0%");
  });
});

describe("formatRelativeTime", () => {
  const now = 1_000_000_000;

  it("shows 'just now' for anything under a minute", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
  });

  it("shows minutes, hours, and days appropriately", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("clamps future timestamps to 'just now' rather than a negative duration", () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe("just now");
  });
});
