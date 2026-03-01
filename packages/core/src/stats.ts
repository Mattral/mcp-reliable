/**
 * Computes the p-th percentile of a set of numbers using the "nearest rank"
 * method: sort ascending, then take the value at rank ceil(p/100 * n).
 *
 * This is intentionally simple (no interpolation) so results are easy to
 * reason about and reproduce by hand — appropriate for a v0 health scorer.
 * Returns 0 for an empty input.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  if (p <= 0) return Math.min(...values);
  if (p >= 100) return Math.max(...values);

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] as number;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
