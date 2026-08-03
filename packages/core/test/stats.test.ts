import { describe, expect, it } from "vitest";
import { kolmogorovSmirnovTest, mean, percentile } from "../src/stats.js";

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

describe("kolmogorovSmirnovTest", () => {
  it("returns statistic 0 and pValue 1 when either sample is empty", () => {
    expect(kolmogorovSmirnovTest([], [1, 2, 3])).toEqual({ statistic: 0, pValue: 1 });
    expect(kolmogorovSmirnovTest([1, 2, 3], [])).toEqual({ statistic: 0, pValue: 1 });
    expect(kolmogorovSmirnovTest([], [])).toEqual({ statistic: 0, pValue: 1 });
  });

  it("computes the D statistic by hand for a small, easily-checked case", () => {
    // a=[1,2,3,4], b=[2,3,4,5]. Walking the combined sorted values 1..5:
    // at 1: ecdfA=1/4=.25, ecdfB=0/4=0    -> gap .25
    // at 2: ecdfA=2/4=.5,  ecdfB=1/4=.25  -> gap .25
    // at 3: ecdfA=3/4=.75, ecdfB=2/4=.5   -> gap .25
    // at 4: ecdfA=4/4=1,   ecdfB=3/4=.75  -> gap .25
    // at 5: ecdfA=4/4=1,   ecdfB=4/4=1    -> gap 0
    // max gap = 0.25
    const { statistic } = kolmogorovSmirnovTest([1, 2, 3, 4], [2, 3, 4, 5]);
    expect(statistic).toBeCloseTo(0.25, 10);
  });

  it("gives D=1 and a very small p-value for two disjoint samples at a realistic sample size", () => {
    // n=3 per sample would also give D=1, but the asymptotic p-value
    // approximation is deliberately weak at such tiny samples (see the
    // function's own docstring) — this uses n=20 per side, matching
    // detectLatencyDrift's actual minSampleSize default, so the assertion
    // reflects how the test performs at realistic usage sizes.
    const a = Array.from({ length: 20 }, (_, i) => i);
    const b = Array.from({ length: 20 }, (_, i) => 1000 + i);
    const { statistic, pValue } = kolmogorovSmirnovTest(a, b);
    expect(statistic).toBe(1);
    expect(pValue).toBeLessThan(0.001);
  });

  it("is insensitive to input order (unsorted input gives the same result as sorted)", () => {
    const a1 = [5, 1, 3, 2, 4];
    const a2 = [1, 2, 3, 4, 5];
    const b = [10, 8, 6, 9, 7];
    expect(kolmogorovSmirnovTest(a1, b)).toEqual(kolmogorovSmirnovTest(a2, b));
  });

  it("does not flag two large samples drawn from the same distribution as significant", () => {
    // Deterministic pseudo-samples (not Math.random(), so this is
    // reproducible) drawn to look like the same underlying distribution —
    // interleaved small perturbations of a common base, not two visibly
    // different populations.
    const base = Array.from({ length: 40 }, (_, i) => 100 + ((i * 37) % 23));
    const a = base.map((v, i) => v + (i % 2 === 0 ? 1 : -1));
    const b = base.map((v, i) => v + (i % 2 === 0 ? -1 : 1));
    const { pValue } = kolmogorovSmirnovTest(a, b);
    expect(pValue).toBeGreaterThan(0.01);
  });

  it("matches a value independently cross-checked against scipy.stats.ks_2samp", () => {
    // n=30 baseline centered at 100, n=30 shifted sample centered at 150,
    // both with a fixed, hand-written spread (not random) so this is
    // exactly reproducible. Verified during development against
    // `scipy.stats.ks_2samp(a, b, method="asymp")`, which reports
    // statistic=1.0, pvalue≈0 for this exact pair (fully disjoint ranges
    // by construction) — see docs/decisions/0015-statistical-drift-detection.md
    // for the broader verification methodology (2,000 randomized trials).
    const a = Array.from({ length: 30 }, (_, i) => 90 + (i % 10));
    const b = Array.from({ length: 30 }, (_, i) => 150 + (i % 10));
    const { statistic, pValue } = kolmogorovSmirnovTest(a, b);
    expect(statistic).toBe(1);
    expect(pValue).toBeLessThan(1e-6);
  });
});
