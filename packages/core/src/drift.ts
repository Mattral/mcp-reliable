import { randomUUID } from "node:crypto";
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
