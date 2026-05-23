/**
 * Mirrors packages/cli/src/format.ts's score bands (>=90 good, >=70 warn,
 * else bad) and severity coloring exactly, so a server never looks "green"
 * in the terminal and "amber" on the dashboard. Reimplemented rather than
 * shared for the same node:crypto-in-browser reason documented in
 * ./types.ts and docs/decisions/0008-dashboard-stack-and-duplication.md.
 */
export type ScoreBand = "good" | "warn" | "bad";

export function classifyScore(score: number): ScoreBand {
  if (score >= 90) return "good";
  if (score >= 70) return "warn";
  return "bad";
}

const BAND_TEXT_CLASS: Record<ScoreBand, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad"
};

const BAND_DOT_CLASS: Record<ScoreBand, string> = {
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad"
};

export function scoreTextClass(score: number): string {
  return BAND_TEXT_CLASS[classifyScore(score)];
}

export function scoreDotClass(score: number): string {
  return BAND_DOT_CLASS[classifyScore(score)];
}

const SEVERITY_TEXT_CLASS: Record<string, string> = {
  low: "text-text-muted",
  medium: "text-warn",
  high: "text-bad",
  info: "text-info",
  warning: "text-warn",
  critical: "text-bad"
};

export function severityTextClass(severity: string): string {
  return SEVERITY_TEXT_CLASS[severity] ?? "text-text-primary";
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatScore(score: number): string {
  return score.toFixed(1);
}

/** A short "3m ago" / "2h ago" style relative timestamp for drift/alert lists. */
export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - epochMs);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
