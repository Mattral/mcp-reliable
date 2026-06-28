import { DEFAULT_HEALTH_DEGRADATION_THRESHOLDS, type HealthDegradationThresholds } from "./alerts.js";

export type RecommendationLevel = "avoid" | "caution" | "healthy" | "unknown";

export interface Recommendation {
  level: RecommendationLevel;
  reason: string;
}

export interface RecommendationInput {
  /** The most recent health check's result, or `null` if none has ever run. */
  reachable: boolean | null;
  /** A trailing-window tool health score, or `null` if there's no proxy-observed traffic yet. */
  healthScore: number | null;
  /** Whether any drift event at `high` severity was detected within the window this input was built from. */
  recentHighSeverityDrift: boolean;
}

/**
 * Synthesizes a single should-I-use-this-right-now verdict for a server
 * from its current reachability, tool health score, and recent drift —
 * the "recommendations" half of the spec's "Agents can query health,
 * drift, and recommendations" (§5, target user persona 3: "Agent itself").
 *
 * Checked in priority order — unreachable outranks a stale health score,
 * which outranks drift — because each is a strictly stronger signal that
 * something is currently wrong, not just historically wrong:
 *
 * 1. `avoid`, unreachable: nothing else matters if the server isn't up.
 * 2. `avoid`, critical health score: technically reachable, but recent
 *    real traffic mostly failed.
 * 3. `caution`, degraded health score: recent real traffic had a
 *    meaningfully elevated failure/latency rate, short of critical.
 * 4. `caution`, recent high-severity drift: nothing's failing yet, but a
 *    schema or output contract changed recently enough that assumptions
 *    an integration was built on may no longer hold.
 * 5. `unknown`: no data of either kind yet — not the same as `healthy`,
 *    since "no signal" and "good signal" are different states an agent
 *    should be able to tell apart (see `data-model.md#health-vs-reachability`
 *    for the same reasoning applied elsewhere in this project).
 * 6. `healthy`: none of the above.
 */
export function buildRecommendation(
  input: RecommendationInput,
  thresholds: HealthDegradationThresholds = DEFAULT_HEALTH_DEGRADATION_THRESHOLDS
): Recommendation {
  if (input.reachable === false) {
    return { level: "avoid", reason: "Server is currently unreachable." };
  }

  if (input.healthScore !== null) {
    if (input.healthScore < thresholds.criticalBelow) {
      return {
        level: "avoid",
        reason: `Reliability is critically degraded (health score ${input.healthScore.toFixed(1)}).`
      };
    }
    if (input.healthScore < thresholds.warningBelow) {
      return {
        level: "caution",
        reason: `Reliability is degraded (health score ${input.healthScore.toFixed(1)}).`
      };
    }
  }

  if (input.recentHighSeverityDrift) {
    return {
      level: "caution",
      reason: "A high-severity schema or output change was recently detected — verify integration assumptions still hold."
    };
  }

  if (input.reachable === null && input.healthScore === null) {
    return { level: "unknown", reason: "No health-check or traffic data recorded for this server yet." };
  }

  return { level: "healthy", reason: "No known reliability issues." };
}
