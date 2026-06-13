import { randomUUID } from "node:crypto";
import type { Alert, AlertSeverity, DriftEvent, DriftSeverity, HealthScore } from "./types.js";

const DRIFT_SEVERITY_TO_ALERT_SEVERITY: Record<DriftSeverity, AlertSeverity> = {
  low: "info",
  medium: "warning",
  high: "critical"
};

/** Converts a detected drift event into an alert, carrying its severity across on the same scale. */
export function driftEventToAlert(event: DriftEvent, now: number = Date.now()): Alert {
  return {
    id: randomUUID(),
    serverId: event.serverId,
    triggeredAt: now,
    severity: DRIFT_SEVERITY_TO_ALERT_SEVERITY[event.severity],
    kind: "drift",
    message: event.description
  };
}

export interface HealthDegradationThresholds {
  /** Score at/above which a server is considered healthy — no alert. Default 70. */
  warningBelow: number;
  /** Score below which a degradation is `critical` rather than `warning`. Default 50. */
  criticalBelow: number;
}

export const DEFAULT_HEALTH_DEGRADATION_THRESHOLDS: HealthDegradationThresholds = {
  warningBelow: 70,
  criticalBelow: 50
};

type Band = "healthy" | "warning" | "critical";

function bandFor(score: number, thresholds: HealthDegradationThresholds): Band {
  if (score < thresholds.criticalBelow) return "critical";
  if (score < thresholds.warningBelow) return "warning";
  return "healthy";
}

/**
 * Detects a *transition* into (or a worsening within) a degraded health
 * band, comparing a newly computed score against the previous one on
 * record for the same server. Returns `null` when there's nothing to
 * alert on: no previous score to compare against, no samples in the
 * current window, the server is healthy, or the band is unchanged from
 * last time.
 *
 * Transition-only is a deliberate choice: a server that's been sitting at
 * a 40 for the last six hours doesn't need a fresh alert on every single
 * check — only when it first crosses into trouble (or gets worse, e.g.
 * warning -> critical). Recovery is symmetric: crossing back up out of a
 * degraded band is the monitor loop's job to resolve, not this function's
 * (see `reconcileHealthDegradationAlert` in the CLI, which pairs with
 * this the same way `reconcileUnreachableAlert` already did for
 * reachability).
 */
export function detectHealthDegradation(
  serverId: string,
  previousScore: number | undefined,
  currentScore: HealthScore,
  thresholds: HealthDegradationThresholds = DEFAULT_HEALTH_DEGRADATION_THRESHOLDS
): Alert | null {
  if (currentScore.sampleCount === 0) return null;

  const currentBand = bandFor(currentScore.score, thresholds);
  if (currentBand === "healthy") return null;

  const previousBand = previousScore === undefined ? "healthy" : bandFor(previousScore, thresholds);
  if (previousBand === currentBand) return null;

  return {
    id: randomUUID(),
    serverId,
    triggeredAt: Date.now(),
    severity: currentBand,
    kind: "health-degradation",
    message: `Health score dropped to ${currentScore.score.toFixed(1)} (${currentBand}, was ${
      previousScore === undefined ? "no prior data" : previousScore.toFixed(1)
    })`
  };
}
