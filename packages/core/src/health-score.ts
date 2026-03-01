import type { DriftEvent, DriftSeverity, Execution, HealthScore } from "./types.js";
import { percentile } from "./stats.js";

/**
 * Tunable parameters for {@link computeHealthScore}. Defaults are chosen to
 * be reasonable for typical MCP tool calls (sub-second is good, multi-second
 * is bad) and are deliberately exposed so operators can tune them per
 * server via configuration rather than editing code.
 *
 * The full derivation and rationale for these defaults is written up in
 * docs/decisions/0005-health-score-formula.md.
 */
export interface HealthScoreWeights {
  /** Weight of success rate in the composite score. */
  successWeight: number;
  /** Weight of latency in the composite score. successWeight + latencyWeight should equal 1. */
  latencyWeight: number;
  /** p95 latency (ms) at or below which latency scores a perfect 1.0. */
  latencyGoodMs: number;
  /** p95 latency (ms) at or above which latency scores 0.0. */
  latencyBadMs: number;
  /** Points deducted per unresolved drift event of each severity, applied after the base score. */
  driftPenalty: Record<DriftSeverity, number>;
  /** Maximum total points that can be deducted for drift, regardless of event count. */
  maxDriftPenalty: number;
}

export const DEFAULT_HEALTH_SCORE_WEIGHTS: HealthScoreWeights = {
  successWeight: 0.65,
  latencyWeight: 0.35,
  latencyGoodMs: 500,
  latencyBadMs: 5000,
  driftPenalty: { low: 3, medium: 8, high: 15 },
  maxDriftPenalty: 30
};

/** Linearly maps p95 latency to a 0..1 "goodness" score, clamped at both ends. */
function latencyScore(p95Ms: number, weights: HealthScoreWeights): number {
  const { latencyGoodMs, latencyBadMs } = weights;
  if (p95Ms <= latencyGoodMs) return 1;
  if (p95Ms >= latencyBadMs) return 0;
  return 1 - (p95Ms - latencyGoodMs) / (latencyBadMs - latencyGoodMs);
}

export interface ComputeHealthScoreOptions {
  serverId: string;
  windowStart: number;
  windowEnd: number;
  executions: readonly Execution[];
  /** Unresolved drift events that fall within the window, if any. */
  driftEvents?: readonly DriftEvent[];
  weights?: Partial<HealthScoreWeights>;
}

/**
 * Computes a composite reliability score (0-100) for a server over a time
 * window, from raw execution records.
 *
 * Formula: `score = 100 * successRate * (successWeight + latencyWeight * latencyScore(p95))`,
 * then drift penalties are subtracted (capped at `maxDriftPenalty`), then the
 * result is clamped to [0, 100].
 *
 * `successRate` is a *multiplicative gate*, not just one term in a weighted
 * average: a server that fails every call scores exactly 0, no matter how
 * fast those failures are, because "fails instantly" is not a meaningfully
 * healthier state than "fails slowly" — both are 100% broken. Within the
 * ceiling that successRate sets, latency still matters: at 100% success,
 * the score ranges from `successWeight * 100` (worst-case latency) up to
 * 100 (best-case latency), which is why a technically-successful tool that
 * takes 10 seconds still gets marked down relative to a fast one.
 *
 * With zero executions in the window, the score is 0 and sampleCount is 0 —
 * callers should treat that as "no data", not "healthy".
 */
export function computeHealthScore(options: ComputeHealthScoreOptions): HealthScore {
  const weights = { ...DEFAULT_HEALTH_SCORE_WEIGHTS, ...options.weights };
  const executions = options.executions;
  const sampleCount = executions.length;

  if (sampleCount === 0) {
    return {
      serverId: options.serverId,
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
      score: 0,
      successRate: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      errorRate: 0,
      sampleCount: 0
    };
  }

  const successCount = executions.filter((e) => e.success).length;
  const successRate = successCount / sampleCount;
  const durations = executions.map((e) => e.durationMs);
  const p50LatencyMs = percentile(durations, 50);
  const p95LatencyMs = percentile(durations, 95);

  const weightedBlend = weights.successWeight + weights.latencyWeight * latencyScore(p95LatencyMs, weights);
  const base = 100 * successRate * weightedBlend;

  const drift = options.driftEvents ?? [];
  const rawDriftPenalty = drift.reduce((sum, event) => sum + weights.driftPenalty[event.severity], 0);
  const driftPenalty = Math.min(rawDriftPenalty, weights.maxDriftPenalty);

  const score = Math.max(0, Math.min(100, base - driftPenalty));

  return {
    serverId: options.serverId,
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
    score,
    successRate,
    p50LatencyMs,
    p95LatencyMs,
    errorRate: 1 - successRate,
    sampleCount
  };
}
