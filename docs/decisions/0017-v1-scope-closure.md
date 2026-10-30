# 0017 — v1 scope closure and maintenance mode

## Status

Accepted.

## Context

After 1.1.0, everything left on `docs/roadmap.md` fell into one of four
groups:

1. **Items that need a product decision before any code** — token usage
   tracking and output-*value* drift. The roadmap already said so for
   both: real token counts need a tokenizer matched to the calling
   agent's model, which this project has no way to know, and value drift
   needs a data-retention decision (which fields, what depth, how long)
   with real privacy surface (see ADR 0015).
2. **One substantial, self-contained technical project** — SSE/HTTP
   support in the traffic-observing proxy, and with it an HTTP transport
   for the agent interface. Not a small extension of the stdio proxy:
   there's no child process to sit in front of, so it's a different
   collection model, not a new transport flag.
3. **The P2 "advanced capabilities"** — cost optimization, a custom rule
   engine, an OpenTelemetry exporter, ML-based anomaly detection, team
   features. The original spec itself framed these as later-stage work;
   team features alone would need multi-user auth and tenancy that don't
   exist anywhere in the current design.
4. **Small rough edges** — already listed under "Known limitations" in the
   roadmap (per-server polling cadence, persisted alert configuration,
   client-side per-tool aggregation in the dashboard, and so on), plus the
   dashboard not yet showing the error-category breakdown (ADR 0016).

No issue or feature request has been filed against any of these. Meanwhile
the cost of leaving the repository open-ended was concrete: a roadmap full
of "not yet" items, and documentation that drifted out of date between
passes (a stale release tag, an audit section describing advisories that
had since changed). A finished, accurate project is more useful than an
indefinitely-in-progress one.

## Decision

**v1 is feature-complete.** Groups 1–3 are out of scope for v1, marked ⛔
(or 🚧 where part of the item shipped) in `docs/roadmap.md` rather than
left as open work. Group 4 stays documented as known limitations — they
don't block any v1 use, and listing them honestly is more useful than
either hiding them or building them speculatively.

**Maintenance mode** from 1.2.0 onward means:

- Dependency advisories get fixed and released. 1.2.0 was the first such
  release: `npm audit` went from 20 findings (4 critical) to 0 — see
  `docs/testing.md#dependency-audit-status`.
- Bug reports get fixed, with a regression test, same standard as every
  earlier bug in these ADRs.
- Documentation is kept true to the code. A doc claim that's discovered to
  be wrong is a bug.
- No new features without a concrete use case behind them.

**What would reopen scope:** an issue describing a real deployment that
needs it. If one item comes back first, it's most likely group 2 — remote
MCP servers over HTTP are the transport this tool can't observe traffic
for today — and it should get its own ADR before any code, the way ADR
0003 did for the stdio collection model.

## Consequences

- `README.md` and `docs/roadmap.md` state the project's status directly
  rather than implying ongoing feature work.
- Nothing is deleted: the roadmap keeps every out-of-scope item with its
  reasoning, so picking one up later starts from the existing analysis
  rather than from scratch.
- Releases from here on are expected to be patch or minor versions driven
  by dependencies and fixes. 1.2.0 is a minor rather than a patch only
  because of the `zod` 3 → 4 move (see `CHANGELOG.md`).
