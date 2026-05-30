import type { Alert, DriftEvent } from "../lib/types.js";
import { formatRelativeTime } from "../lib/format.js";
import { SeverityTag } from "./SeverityTag.js";

interface DriftAndAlertsProps {
  driftEvents: DriftEvent[];
  alerts: Alert[];
}

type TimelineItem =
  | { kind: "drift"; at: number; event: DriftEvent }
  | { kind: "alert"; at: number; alert: Alert };

export function DriftAndAlerts({ driftEvents, alerts }: DriftAndAlertsProps) {
  const items: TimelineItem[] = [
    ...driftEvents.map((event): TimelineItem => ({ kind: "drift", at: event.detectedAt, event })),
    ...alerts.map((alert): TimelineItem => ({ kind: "alert", at: alert.triggeredAt, alert }))
  ].sort((a, b) => b.at - a.at);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-4 text-sm text-text-muted">
        No drift or alerts recorded yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.kind === "drift" ? item.event.id : item.alert.id} className="text-sm">
            {item.kind === "drift" ? (
              <div>
                <SeverityTag severity={item.event.severity} /> <span className="text-text-primary">{item.event.description}</span>
                <div className="font-mono text-xs text-text-muted">{formatRelativeTime(item.event.detectedAt)}</div>
              </div>
            ) : (
              <div>
                <SeverityTag severity={item.alert.severity} /> <span className="text-text-primary">{item.alert.message}</span>
                {item.alert.resolvedAt ? (
                  <span className="ml-2 text-xs text-good">resolved</span>
                ) : (
                  <span className="ml-2 text-xs text-warn">open</span>
                )}
                <div className="font-mono text-xs text-text-muted">{formatRelativeTime(item.alert.triggeredAt)}</div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
