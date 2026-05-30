import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Alert, DriftEvent, Execution, HealthScore, Server, TransportConfig } from "../lib/types.js";
import { StatusDot } from "../components/StatusDot.js";
import { ScoreReadout } from "../components/ScoreReadout.js";
import { HealthHistoryChart } from "../components/HealthHistoryChart.js";
import { ToolBreakdownTable } from "../components/ToolBreakdownTable.js";
import { DriftAndAlerts } from "../components/DriftAndAlerts.js";
import { ExecutionsLog } from "../components/ExecutionsLog.js";

const WINDOW_MS = 24 * 3_600_000;
const POLL_MS = 15_000;

function describeTransport(transport: TransportConfig): string {
  switch (transport.type) {
    case "stdio":
      return `stdio: ${[transport.command, ...(transport.args ?? [])].join(" ")}`;
    case "sse":
      return `sse: ${transport.url}`;
    case "http":
      return `http: ${transport.url}`;
  }
}

interface DetailData {
  server: Server;
  reachable: boolean | null;
  healthScore: HealthScore | null;
  sampleCount: number;
  history: HealthScore[];
  executions: Execution[];
  driftEvents: DriftEvent[];
  alerts: Alert[];
}

export function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      try {
        const [server, health, history, executions, driftEvents, alerts] = await Promise.all([
          api.getServer(id!),
          api.getHealth(id!, WINDOW_MS),
          api.healthHistory(id!),
          api.listExecutions(id!, { limit: 200 }),
          api.listDrift(id!),
          api.listAlerts(id!)
        ]);
        if (cancelled) return;
        setData({
          server,
          reachable: health.lastHealthCheck?.success ?? null,
          healthScore: health.healthScore,
          sampleCount: health.healthScore?.sampleCount ?? 0,
          history,
          executions,
          driftEvents,
          alerts
        });
        setError(null);
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
  }, [id]);

  if (error) {
    return (
      <div>
        <BackLink />
        <div className="mt-4 rounded-lg border border-border bg-panel p-6 font-mono text-sm text-bad">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <BackLink />
        <div className="mt-4 font-mono text-sm text-text-muted">Loading…</div>
      </div>
    );
  }

  const { server, reachable, healthScore, sampleCount, history, executions, driftEvents, alerts } = data;

  return (
    <div>
      <BackLink />

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusDot reachable={reachable} />
            <h1 className="text-lg font-medium text-text-primary">{server.name}</h1>
          </div>
          <p className="mt-1 font-mono text-xs text-text-muted">{describeTransport(server.transport)}</p>
          {server.tags.length > 0 ? (
            <div className="mt-2 flex gap-1.5">
              {server.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-panel-hover px-2 py-0.5 font-mono text-xs text-text-muted">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6">
        <ScoreReadout score={healthScore?.score ?? null} sampleCount={sampleCount} windowLabel="last 24h" />
      </div>

      <div className="mt-6">
        <SectionLabel>health history</SectionLabel>
        <HealthHistoryChart scores={history} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <SectionLabel>tools</SectionLabel>
          <ToolBreakdownTable executions={executions} />
        </div>
        <div>
          <SectionLabel>drift &amp; alerts</SectionLabel>
          <DriftAndAlerts driftEvents={driftEvents} alerts={alerts} />
        </div>
      </div>

      <div className="mt-6">
        <SectionLabel>recent executions</SectionLabel>
        <ExecutionsLog executions={executions} />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-text-muted">{children}</h2>;
}

function BackLink() {
  return (
    <Link to="/" className="font-mono text-xs text-text-muted hover:text-info">
      ← fleet
    </Link>
  );
}
