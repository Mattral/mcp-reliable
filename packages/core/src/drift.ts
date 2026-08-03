import { randomUUID } from "node:crypto";
import { kolmogorovSmirnovTest, percentile } from "./stats.js";
import type { DriftEvent, Execution } from "./types.js";

/**
 * Compares a tool's previously recorded schema fingerprint against a newly
 * observed one. Schema changes are structural (a required parameter added,
 * a type changed) and are always treated as `high` severity, since they can
 * silently break callers that built requests against the old schema.
 *
 * Returns `null` when there is no previous fingerprint to compare against
 * (first observation) or the fingerprint is unchanged.
 */
export function detectSchemaDrift(params: {
  serverId: string;
  toolName: string;
  previousFingerprint: string | undefined;
  currentFingerprint: string;
  now?: number;
}): DriftEvent | null {
  const { serverId, toolName, previousFingerprint, currentFingerprint } = params;
  if (!previousFingerprint || previousFingerprint === currentFingerprint) return null;

  return {
    id: randomUUID(),
    serverId,
    toolName,
    detectedAt: params.now ?? Date.now(),
    kind: "schema",
    severity: "high",
    description: `Input schema for tool "${toolName}" changed`,
    previousValue: previousFingerprint,
    newValue: currentFingerprint
  };
}

interface DominantSignature {
  signature: string;
  ratio: number;
  count: number;
  total: number;
}

/**
 * Finds the most frequently occurring `outputSignature` among a set of
 * (successful) executions, and what fraction of the set it represents.
 * Executions without a recorded signature (e.g. failed calls) are ignored.
 */
function dominantSignature(executions: readonly Execution[]): DominantSignature | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const e of executions) {
    if (!e.success || !e.outputSignature) continue;
    total += 1;
    counts.set(e.outputSignature, (counts.get(e.outputSignature) ?? 0) + 1);
  }
  if (total === 0) return null;

  let best: DominantSignature | null = null;
  for (const [signature, count] of counts) {
    if (!best || count > best.count) {
      best = { signature, count, total, ratio: count / total };
    }
  }
  return best;
}

export interface OutputShapeDriftOptions {
  serverId: string;
  toolName: string;
  /** An earlier window of executions establishing the "normal" output shape. */
  baseline: readonly Execution[];
  /** A more recent window of executions to compare against the baseline. */
  recent: readonly Execution[];
  /** Minimum successful, signed executions required in *each* window to draw a conclusion. Default 5. */
  minSampleSize?: number;
  /**
   * Minimum fraction of `recent` that must share the same (new) dominant
   * shape before we call it drift rather than noise. Default 0.6 — a single
   * outlier response should not trigger an alert.
   */
  minDominance?: number;
  now?: number;
}

/**
 * P0-level behavioral drift detector: flags a tool when the *shape* of its
 * output (keys, nesting, primitive types — never values) has durably
 * changed between an earlier baseline window and a more recent window.
 *
 * This deliberately stops short of statistical comparison of output values
 * or latency distributions, which is a P1 feature (see docs/roadmap.md and
 * docs/decisions/0005-health-score-formula.md for what's next).
 *
 * Returns `null` when there isn't enough data in either window, or when the
 * dominant shape is unchanged, or when the recent window is too mixed
 * (below `minDominance`) to confidently call it drift rather than noise.
 */
export function detectOutputShapeDrift(options: OutputShapeDriftOptions): DriftEvent | null {
  const minSampleSize = options.minSampleSize ?? 5;
  const minDominance = options.minDominance ?? 0.6;

  if (options.baseline.length < minSampleSize || options.recent.length < minSampleSize) {
    return null;
  }

  const baselineDominant = dominantSignature(options.baseline);
  const recentDominant = dominantSignature(options.recent);
  if (!baselineDominant || !recentDominant) return null;
  if (baselineDominant.signature === recentDominant.signature) return null;
  if (recentDominant.ratio < minDominance) return null;

  const severity = recentDominant.ratio >= 0.9 ? "high" : recentDominant.ratio >= 0.75 ? "medium" : "low";

  return {
    id: randomUUID(),
    serverId: options.serverId,
    toolName: options.toolName,
    detectedAt: options.now ?? Date.now(),
    kind: "output-shape",
    severity,
    description: `Output shape for tool "${options.toolName}" changed in ${Math.round(
      recentDominant.ratio * 100
    )}% of recent calls`,
    previousValue: baselineDominant.signature,
    newValue: recentDominant.signature
  };
}

export interface LatencyDriftOptions {
  serverId: string;
  toolName: string;
  /** An earlier window of executions establishing the "normal" latency distribution. */
  baseline: readonly Execution[];
  /** A more recent window of executions to compare against the baseline. */
  recent: readonly Execution[];
  /**
   * Minimum successful executions required in *each* window before a KS
   * test is even attempted. Default 20 — a KS test on smaller samples has
   * weak enough power that it would mostly be reacting to noise; 20 is a
   * common rule-of-thumb floor for the test to have reasonable
   * sensitivity, not a value derived specifically for this project.
   */
  minSampleSize?: number;
  /**
   * Significance threshold for the KS test's p-value. Default 0.01, not
   * the more conventional 0.05 — this check runs repeatedly as traffic
   * accumulates (effectively many tests over a tool's lifetime, not one),
   * so a looser threshold would produce false-positive alerts often enough
   * to train operators to ignore them. 0.01 doesn't formally correct for
   * repeated testing (a Bonferroni-style correction would be the rigorous
   * fix) but is a deliberately conservative default given that gap exists.
   */
  alpha?: number;
  /**
   * Minimum relative shift in median latency required, on top of
   * statistical significance, before reporting drift. Default 0.2 (20%).
   * With enough samples, a KS test will call almost *any* real difference
   * "significant" even when it's operationally meaningless (a 2ms shift on
   * a 50ms baseline) — this floor is the same role `minDominance` plays for
   * {@link detectOutputShapeDrift}: statistical significance alone isn't
   * sufficient justification for an alert.
   */
  minRelativeShift?: number;
  now?: number;
}

/**
 * Statistical (P1) behavioral drift detector: flags a tool when the
 * *distribution* of its successful calls' latency has shifted meaningfully
 * between an earlier baseline window and a more recent window, using a
 * two-sample Kolmogorov-Smirnov test (see `kolmogorovSmirnovTest` in
 * `stats.ts` for the test itself and how it was verified).
 *
 * This catches a case the fixed p95 threshold in `computeHealthScore`
 * cannot: a tool that's gotten durably slower (or faster) but not enough to
 * cross that fixed threshold — see
 * docs/decisions/0007-drift-detection-v0-scope.md and
 * docs/decisions/0015-statistical-drift-detection.md.
 *
 * Only successful executions are compared — a spike in failures (which may
 * complete unusually fast via an early error, or unusually slow via a
 * timeout) is a *reliability* signal already covered by health scoring and
 * unreachable alerts, not a latency-distribution signal in its own right.
 *
 * Returns `null` when either window has too few successful executions, the
 * KS test isn't significant at `alpha`, or the shift in median latency is
 * below `minRelativeShift` even if statistically significant.
 */
export function detectLatencyDrift(options: LatencyDriftOptions): DriftEvent | null {
  const minSampleSize = options.minSampleSize ?? 20;
  const alpha = options.alpha ?? 0.01;
  const minRelativeShift = options.minRelativeShift ?? 0.2;

  const baselineLatencies = options.baseline.filter((e) => e.success).map((e) => e.durationMs);
  const recentLatencies = options.recent.filter((e) => e.success).map((e) => e.durationMs);
  if (baselineLatencies.length < minSampleSize || recentLatencies.length < minSampleSize) {
    return null;
  }

  const { pValue } = kolmogorovSmirnovTest(baselineLatencies, recentLatencies);
  if (pValue > alpha) return null;

  const baselineMedian = percentile(baselineLatencies, 50);
  const recentMedian = percentile(recentLatencies, 50);
  const relativeShift =
    baselineMedian === 0 ? (recentMedian === 0 ? 0 : Number.POSITIVE_INFINITY) : Math.abs(recentMedian - baselineMedian) / baselineMedian;
  if (relativeShift < minRelativeShift) return null;

  const severity = relativeShift >= 1.0 || pValue <= 0.001 ? "high" : relativeShift >= 0.5 ? "medium" : "low";
  const direction = recentMedian > baselineMedian ? "slower" : "faster";

  return {
    id: randomUUID(),
    serverId: options.serverId,
    toolName: options.toolName,
    detectedAt: options.now ?? Date.now(),
    kind: "statistical",
    metric: "latency",
    severity,
    description: `Latency for tool "${options.toolName}" got ${direction}: median ${Math.round(
      baselineMedian
    )}ms → ${Math.round(recentMedian)}ms (KS test p=${pValue.toFixed(4)}, n=${baselineLatencies.length}/${recentLatencies.length})`,
    previousValue: `median=${Math.round(baselineMedian)}ms, n=${baselineLatencies.length}`,
    newValue: `median=${Math.round(recentMedian)}ms, n=${recentLatencies.length}`
  };
}
