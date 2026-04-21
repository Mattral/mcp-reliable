import chalk from "chalk";

const DURATION_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
};

/**
 * Parses a short duration string like `"7d"`, `"24h"`, `"30m"`, or a
 * combination like `"1d12h"` into milliseconds. Used by `--last` on the
 * `report` command. Throws a descriptive error for anything it can't parse,
 * rather than silently defaulting — a wrong time window would produce a
 * confidently wrong report.
 */
export function parseDuration(input: string): number {
  const trimmed = input.trim().toLowerCase();
  const pattern = /(\d+)\s*(d|h|m|s)/g;
  let match: RegExpExecArray | null;
  let totalMs = 0;
  let matchedAnything = false;

  while ((match = pattern.exec(trimmed)) !== null) {
    matchedAnything = true;
    const amount = Number(match[1]);
    const unit = match[2] as string;
    totalMs += amount * (DURATION_UNIT_MS[unit] ?? 0);
  }

  if (!matchedAnything || totalMs <= 0) {
    throw new Error(
      `Could not parse duration "${input}". Use a value like "1h", "24h", "7d", or "30m".`
    );
  }
  return totalMs;
}

/** Health-score color bands, matching the severity bands used in health-score.ts's drift penalties. */
export function colorForScore(score: number): (text: string) => string {
  if (score >= 90) return chalk.green;
  if (score >= 70) return chalk.yellow;
  return chalk.red;
}

export function formatScore(score: number): string {
  return colorForScore(score)(score.toFixed(1));
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const SEVERITY_COLOR: Record<string, (text: string) => string> = {
  low: chalk.gray,
  medium: chalk.yellow,
  high: chalk.red,
  info: chalk.blue,
  warning: chalk.yellow,
  critical: chalk.red
};

export function formatSeverity(severity: string): string {
  const colorFn = SEVERITY_COLOR[severity] ?? ((text: string) => text);
  return colorFn(severity.toUpperCase());
}
