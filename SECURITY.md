# Security

## Reporting a vulnerability

Please open a private security advisory on GitHub (or email the
maintainer directly if that's not available) rather than a public issue,
and include reproduction steps. This is a young project without a formal
disclosure SLA yet — expect a response, not a guaranteed timeline.

## Operational security posture

See [`docs/architecture.md#security-posture-spec-11`](./docs/architecture.md#security-posture-spec-11)
for the full list. Summary:

- `mcp-reliable` **never invokes a tool** during a health check — it only
  performs the MCP `initialize` handshake and lists tools. This is a
  deliberate boundary, not an oversight: a monitoring tool has no reliable
  way to know that calling an arbitrary tool with synthetic arguments is
  safe.
- The traffic-observing proxy only ever forwards and records calls a real
  client actually made — it never originates a tool call itself.
- The REST API redacts `env`/header **values** (not keys) from any
  transport configuration before returning it as JSON, since server
  registrations routinely carry API keys in `env`.
- The CLI and REST API default to localhost binding; nothing in this
  project has been reviewed for safe exposure beyond a single machine, and
  there is currently no authentication layer on the REST API. Treat it as
  local-only until that changes (tracked in `docs/roadmap.md`).
- Malformed JSON-RPC lines observed by the proxy are forwarded verbatim
  rather than causing the proxy to crash — a corrupt message doesn't take
  down a live session, but is also not parsed into telemetry.

## Dependencies

`npm audit` currently flags a dev-only `esbuild`/`vitest` advisory (a CORS
issue in esbuild's development server). It affects local test tooling
only — it is not a dependency of any published package's runtime code. See
[`docs/testing.md#dependency-audit-status`](./docs/testing.md#dependency-audit-status)
for details, and re-run `npm audit` yourself before relying on this
assessment, since advisories change over time.
