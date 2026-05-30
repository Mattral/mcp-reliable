import type { Execution } from "../lib/types.js";
import { formatClock, formatMs } from "../lib/format.js";

export function ExecutionsLog({ executions }: { executions: Execution[] }) {
  if (executions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-4 text-sm text-text-muted">
        No executions recorded yet.
      </div>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-panel font-mono text-xs">
      {executions.map((e) => (
        <div key={e.id} className="flex items-center gap-3 border-b border-border px-4 py-1.5 last:border-b-0">
          <span className="text-text-muted">{formatClock(e.startedAt)}</span>
          <span className={e.success ? "text-good" : "text-bad"}>{e.success ? "ok " : "ERR"}</span>
          <span className="w-28 truncate text-text-primary">{e.toolName}</span>
          <span className="text-text-muted">{formatMs(e.durationMs)}</span>
          {e.errorMessage ? <span className="truncate text-bad">{e.errorMessage}</span> : null}
        </div>
      ))}
    </div>
  );
}
