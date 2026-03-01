import { describe, expect, it } from "vitest";
import { mean, percentile } from "../src/stats.js";

describe("percentile", () => {
  it("returns 0 for empty input", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns the single value for a one-element array at any percentile", () => {
    expect(percentile([42], 1)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("computes p50 (median) for an odd-length array", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("computes p95 using nearest-rank on a 100-element array", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 95)).toBe(95);
  });

  it("is insensitive to input order", () => {
    const sorted = [10, 20, 30, 40, 50];
    const shuffled = [40, 10, 50, 20, 30];
    expect(percentile(shuffled, 50)).toBe(percentile(sorted, 50));
  });

  it("clamps p<=0 to the minimum and p>=100 to the maximum", () => {
    const values = [5, 1, 9, 3];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 100)).toBe(9);
  });
});

describe("mean", () => {
  it("returns 0 for empty input", () => {
    expect(mean([])).toBe(0);
  });

  it("computes the arithmetic mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});
