import type { Execution } from "./types.js";

export interface ToolStats {
  name: string;
  count: number;
  successRate: number;
  p95Ms: number;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)] ?? 0;
}

/**
 * Aggregates per-tool stats client-side from whatever sample of recent
 * proxy executions the page already fetched, rather than calling a
 * dedicated aggregation endpoint — there isn't one yet. This is an
 * intentional, documented approximation (see
 * docs/dashboard-design.md#api-additions-needed-beforealongside-the-dashboard):
 * fine for a sample of up to a few hundred calls, not a substitute for
 * real server-side aggregation once traffic volume grows.
 */
export function aggregateByTool(executions: Execution[]): ToolStats[] {
  const byTool = new Map<string, Execution[]>();
  for (const e of executions) {
    if (e.source !== "proxy") continue;
    const list = byTool.get(e.toolName) ?? [];
    list.push(e);
    byTool.set(e.toolName, list);
  }

  return Array.from(byTool.entries())
    .map(([name, execs]) => ({
      name,
      count: execs.length,
      successRate: execs.filter((e) => e.success).length / execs.length,
      p95Ms: percentile(
        execs.map((e) => e.durationMs),
        95
      )
    }))
    .sort((a, b) => b.count - a.count);
}
