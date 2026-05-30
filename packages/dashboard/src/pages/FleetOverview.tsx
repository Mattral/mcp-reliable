import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { ServerHealthSummary } from "../lib/types.js";
import { formatMs, formatPercent, formatScore, scoreTextClass } from "../lib/format.js";
import { StatusDot } from "../components/StatusDot.js";

const WINDOW_MS = 24 * 3_600_000;
const POLL_MS = 15_000;

export function FleetOverview() {
  const [summaries, setSummaries] = useState<ServerHealthSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await api.healthSummary(WINDOW_MS);
        if (!cancelled) {
          setSummaries(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-panel p-6 font-mono text-sm text-bad">
        Couldn&apos;t reach the mcp-reliable API: {error}
      </div>
    );
  }

  if (summaries === null) {
    return <div className="font-mono text-sm text-text-muted">Loading…</div>;
  }

  if (summaries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-8">
        <p className="text-sm text-text-muted">No servers registered yet.</p>
        <pre className="mt-4 overflow-x-auto rounded bg-panel-hover p-4 font-mono text-xs text-text-primary">
          mcp-reliable add-server --name my-server --stdio -- npx my-mcp-server
        </pre>
      </div>
    );
  }

  const upCount = summaries.filter((s) => s.lastHealthCheck?.success !== false).length;

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-medium">Fleet</h1>
        <div className="font-mono text-xs text-text-muted">
          <span className={upCount === summaries.length ? "text-good" : "text-warn"}>●</span> {upCount}/
          {summaries.length} up
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-panel">
        <div className="status-row text-xs uppercase tracking-wide text-text-muted">
          <span aria-hidden="true" />
          <span>server</span>
          <span>score</span>
          <span>reach</span>
          <span>latency</span>
          <span>drift</span>
        </div>
        {summaries.map((summary) => (
          <FleetRow key={summary.server.id} summary={summary} />
        ))}
      </div>
    </div>
  );
}

function FleetRow({ summary }: { summary: ServerHealthSummary }) {
  const { server, reachabilityRate, lastHealthCheck, healthScore, unresolvedAlertCount, recentDriftCount } = summary;
  const reachable = lastHealthCheck === null ? null : lastHealthCheck.success;

  return (
    <Link
      to={`/servers/${server.id}`}
      className="status-row transition-colors hover:bg-panel-hover focus-visible:bg-panel-hover"
    >
      <StatusDot reachable={reachable} pulse={unresolvedAlertCount > 0} />
      <span className="truncate text-text-primary">{server.name}</span>
      <span className={healthScore ? scoreTextClass(healthScore.score) : "text-text-muted"}>
        {healthScore ? formatScore(healthScore.score) : "—"}
      </span>
      <span className="text-text-muted">{reachabilityRate === null ? "—" : formatPercent(reachabilityRate)}</span>
      <span className="text-text-muted">{healthScore ? formatMs(healthScore.p95LatencyMs) : "—"}</span>
      <span className={recentDriftCount > 0 ? "text-warn" : "text-text-muted"}>
        {recentDriftCount > 0 ? `${recentDriftCount} new` : "none"}
      </span>
    </Link>
  );
}
