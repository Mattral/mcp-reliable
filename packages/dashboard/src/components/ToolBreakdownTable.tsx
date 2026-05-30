import type { Execution } from "../lib/types.js";
import { aggregateByTool } from "../lib/tool-stats.js";
import { formatMs, formatPercent } from "../lib/format.js";

interface ToolBreakdownTableProps {
  executions: Execution[];
}

export function ToolBreakdownTable({ executions }: ToolBreakdownTableProps) {
  const stats = aggregateByTool(executions);

  if (stats.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-4 text-sm text-text-muted">
        No proxy-observed tool calls in the sample yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-panel">
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem] gap-3 border-b border-border px-4 py-2 font-mono text-xs uppercase tracking-wide text-text-muted">
        <span>tool</span>
        <span>ok</span>
        <span>p95</span>
      </div>
      {stats.map((tool) => (
        <div
          key={tool.name}
          className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem] gap-3 border-b border-border px-4 py-2 font-mono text-sm last:border-b-0"
        >
          <span className="truncate text-text-primary">{tool.name}</span>
          <span className={tool.successRate === 1 ? "text-good" : tool.successRate >= 0.9 ? "text-warn" : "text-bad"}>
            {formatPercent(tool.successRate)}
          </span>
          <span className="text-text-muted">{formatMs(tool.p95Ms)}</span>
        </div>
      ))}
    </div>
  );
}
