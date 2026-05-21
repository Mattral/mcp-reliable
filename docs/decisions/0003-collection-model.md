# 0003 — Collection model: a traffic-observing proxy, not pure push or pull

## Status

Accepted.

## Context

The spec explicitly left this as an open question (§14, Q1): "Should we
support direct instrumentation of MCP servers (push model), or only
observation (pull model) in v1?" It also lists both as architectural
options (§6): "Pull-based collection by default... Optional push model:
High-scale users can instrument servers directly."

Pure pull (periodic health checks only) can tell you a server is *up* and
what tools it currently exposes, but nothing about how real traffic
actually behaves — real argument shapes, real latency under real load,
real failure rates. Pure push (the server imports an SDK and reports
telemetry itself) gets real data but requires every server author to add
code, which cuts directly against the spec's own "Developer Joy" and
"Production First" principles — an observability tool nobody can adopt
without modifying the thing being observed has a steep adoption cliff.

## Decision

Two mechanisms, covering both needs without requiring server-side code
changes:

1. **`HealthChecker`** (pull): connects, does `initialize` + `tools/list`,
   disconnects. Never calls a tool — see the safety rationale in
   `architecture.md#collection-model` and ADR-adjacent reasoning in
   `data-model.md#health-vs-reachability`.
2. **`StdioProxyCollector`** (a third option — call it "transparent
   traffic observation"): spawns the real server as a child process and
   sits transparently between it and the real client, forwarding every
   message unmodified while recording `tools/call` and `tools/list`
   traffic as it passes through. The integration point is a one-line
   change to the *client's* launch configuration (point it at
   `mcp-reliable proxy ...` instead of the original command) — the
   server's source is never touched.

This gets push-like data fidelity (every recorded call is a real call a
real client made) with pull-like adoption friction (zero server-side code
change, one command-line wrapper).

## Consequences

- `StdioProxyCollector` only supports `stdio` transport today, because
  "transparently sit in front of a network connection" is a different
  (and harder) proxying problem than "sit in front of a child process's
  stdin/stdout" — SSE/HTTP proxying is tracked in `roadmap.md`, not built.
- True in-process push instrumentation (a server author imports an SDK
  and reports directly) remains a reasonable future addition for
  high-scale users who want to avoid the extra process hop the proxy
  introduces — nothing in this design precludes adding it later as an
  additional, opt-in collection path feeding the same `ReliabilityStore`.
- Every recorded `Execution` from the proxy corresponds to traffic a real
  client chose to send; `mcp-reliable` never manufactures a tool call
  itself in this mode, so there's no consent question analogous to the one
  `HealthChecker` deliberately avoids by never calling a tool.
