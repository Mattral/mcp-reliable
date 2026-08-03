# @mattral/core

Shared data model, health scoring, drift detection, and error
classification algorithms for [mcp-reliable](https://www.npmjs.com/package/mcp-reliable)
— pure, dependency-light functions with no Node-specific or MCP-transport
code, usable anywhere the same reliability analysis is useful.

```bash
npm install @mattral/core
```

## What's in it

- **Health scoring** — `computeHealthScore(executions)`: a 0–100 score
  from success rate, p95 latency, and recency, with documented,
  independently-derived weightings.
- **Drift detection** — `detectSchemaDrift`, `detectOutputShapeDrift`,
  `detectLatencyDrift`: structural (schema/output-shape) and statistical
  (latency distribution, via a two-sample Kolmogorov-Smirnov test)
  detectors for a tool's behavior changing out from under its callers.
- **Error classification** — `classifyError`, `summarizeErrorCategories`:
  groups failures into common failure modes (rate-limit, auth, timeout,
  validation, connection, server-error) from free-text error messages.
- **Alerts & recommendations** — `driftEventToAlert`,
  `detectHealthDegradation`, `buildRecommendation`: turning raw signals
  into actionable, prioritized guidance.
- **Redaction** — `redact`: strips common PII/secret patterns before
  anything gets logged or stored.
- The full `Execution`, `Server`, `Tool`, `DriftEvent`, `Alert`, and
  `HealthScore` data model, as Zod schemas with inferred types.

## Learn more

This package is the algorithmic core of a larger system — see the
[mcp-reliable GitHub repo](https://github.com/Mattral/mcp-reliable) for
how it fits together, and `docs/data-model.md` /
`docs/decisions/` for the reasoning behind each algorithm's specific
thresholds and design choices.

## License

MIT
