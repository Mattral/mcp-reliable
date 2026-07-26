# 0010 — Alerting: transition-based degradation detection, webhook/Slack delivery, and a shutdown race

## Status

Accepted.

## Context

The `Alert` entity (`kind: "health-degradation" | "drift" | "unreachable"`)
existed in the data model since P0, but only `unreachable` was ever
actually produced (`reconcileUnreachableAlert` in `monitor.ts`), and
nothing delivered an alert anywhere beyond the local SQLite database and
the CLI's own terminal output. The original spec's P1 list calls out
"Webhook + Slack alerting... Notify on health degradation" as a production
requirement.

## Decisions

### Transition-based alerting, not threshold-based

`detectHealthDegradation` (`@mattral/core`) only fires when a
server's health-score *band* changes (healthy → warning, warning →
critical, or vice versa on recovery) — not on every check where a server
happens to still be below some threshold. This mirrors
`reconcileUnreachableAlert`'s existing open-once/resolve-on-recovery
pattern, extended to a continuous score rather than a binary
reachable/unreachable. Without this, a server sitting at a 40 for six
hours would generate one alert per `monitor` tick — the kind of alerting
system nobody trusts because it's noisy while the actually-interesting
information (things just got worse, or things just got better) drowns.

### Drift alerts have no "resolved" state

Unlike reachability and health-degradation, a drift alert represents a
point-in-time detected change (a schema or output shape actually did
change) — there's no natural "recovery" to detect the way there is for a
continuous score or a binary up/down. `recordDriftAlerts` always creates
`resolvedAt: undefined` alerts, matching how the underlying `DriftEvent`
log itself works (an immutable record of "this changed," never marked
resolved).

### Both `monitor` and `proxy` can trigger alerts, not just `monitor`

Schema drift found during a periodic health check (`monitor`) and
output-shape/schema drift found in *live* traffic (`proxy`) are different
events from different collection paths (see
[ADR 0003](./0003-collection-model.md)) — wiring alerting into `proxy` too
means a live production incident (an API contract silently changing under
real traffic) can page someone in real time, not just at the next
scheduled `monitor` tick.

### Webhook + Slack as two notifier implementations behind one interface

`@mattral/notifier` defines a single `Notifier` interface
(`notify(payload): Promise<void>`), with `WebhookNotifier` (generic JSON
POST — the escape hatch for PagerDuty, a custom internal endpoint, etc.)
and `SlackNotifier` (formats the same payload as a plain Slack
incoming-webhook `{text}` message — no Slack app or bot token required)
as separate, composable implementations. `CompositeNotifier` fans a single
alert out to both if both are configured, isolating failures between them
via `Promise.allSettled` so one broken receiver doesn't block delivery to
the other.

Neither notifier ever sends the full `Server` object — only `{id, name}`
— for the same reason the REST API redacts transport secrets (ADR-adjacent
to `packages/server/src/serialize.ts`): a webhook or Slack channel is a
third party by definition, and server registrations routinely carry API
keys in `transport.env`.

## A real bug found during development: lost notifications on shutdown

`proxy`'s `onDrift` callback fires notifications without awaiting them —
correct, since a callback fired mid-message-forwarding must never block
live traffic on webhook latency. The first implementation left it at
that: genuinely fire-and-forget for the life of the whole process.

Manually testing the feature (spin up a mock webhook receiver, drive drift
through a live proxy session, kill the proxy process the moment the
client was done) reproduced a real loss: the process exited before the
in-flight `fetch()` completed, and the receiver got nothing. This isn't a
contrived scenario — it's exactly what happens when a client disconnects
right after triggering drift, or an external process manager kills the
proxy during a deploy.

The fix: `runProxy` now tracks every notification promise it fires
(`pendingNotifications`), and awaits all of them (via `Promise.allSettled`,
capped at a 5s timeout so a genuinely broken receiver can't hang shutdown
indefinitely) on every exit path — the child process exiting on its own,
*and* a `SIGINT`/`SIGTERM` sent to the proxy process itself, which also
now explicitly stops the wrapped child rather than risking an orphaned
grandchild process (a related, previously-unhandled gap this same fix
addressed). Verified by re-running the exact reproduction after the fix:
the notification now arrives before the process exits.

Recorded here rather than fixed silently for the same reason ADR 0005
records the health-score formula bug: a fire-and-forget-for-a-callback
design is correct, and it's easy to accidentally extend that reasoning to
fire-and-forget-for-a-process, which is a different claim that needs its
own justification (or, here, its own fix).

## Consequences

- `mcp-reliable monitor --webhook <url>` / `--slack-webhook <url>` and
  `mcp-reliable proxy <id> --webhook <url> -- ...` (see
  `docs/cli-reference.md`) are the two integration points; there is no
  server-side (REST API) alerting configuration yet — `@mattral/server`
  only ever reads `Alert` records today, it doesn't create or deliver them.
- `monitor` now also computes and persists a trailing-window health score
  every tick (not just when `report` runs), which further densifies the
  `health_scores` history the dashboard's chart reads — a positive side
  effect, not the primary goal of this change.
- Default degradation thresholds (`warningBelow: 70, criticalBelow: 50`,
  matching the CLI's/dashboard's existing score color bands exactly) and
  the default degradation window (1h, via `monitor --window`) are
  reasonable v0 defaults, not yet independently configurable per server —
  tracked as a future refinement in `roadmap.md` alongside the rest of the
  P2 "custom rule engine" item.
