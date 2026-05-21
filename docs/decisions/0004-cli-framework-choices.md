# 0004 — CLI framework: Commander + chalk + cli-table3 + ora, not Ink

## Status

Accepted (deviation from the original spec's stack table).

## Context

The spec's technical stack table (§10) proposes "CLI: Commander + Ink" for
"a rich terminal experience." Ink renders a full React component tree to
the terminal, which is genuinely the right tool for something like a
persistent, richly-interactive TUI dashboard.

## Decision

Use plain Commander for argument parsing (as the spec proposed), but pair
it with `chalk` (color), `cli-table3` (tables), and `ora` (spinners)
instead of Ink for output rendering.

Reasoning: every v0 CLI surface — `servers` (a table), `report` (a
structured printout), `monitor` (a table re-rendered on an interval via
`console.clear()`) — is well served by "print formatted text, occasionally
clear and reprint," which plain formatting libraries handle directly and
predictably. Ink's value shows up when a screen needs real interactive
components (scrollable lists, keyboard-navigable menus, nested live
layouts) — nothing in the current command surface needs that yet, and
adopting Ink now would mean carrying its rendering model and React
dependency for output that doesn't currently need it.

## Consequences

- `monitor`'s live view is a re-rendered `cli-table3` table behind
  `console.clear()`, not a persistent Ink component tree — functionally
  similar for the current single-table use case, less flexible if the
  view needs to grow more complex (e.g. multiple independently-updating
  panels, keyboard input to drill into a specific server without
  re-running the command).
- If a future command needs genuine interactivity (e.g. an interactive
  `add-server` wizard, or a terminal dashboard with multiple live panels
  and keyboard navigation), Ink is worth reintroducing at that point —
  this ADR is scoped to "not needed for v0's command surface," not "never."
- No behavior described in the spec's DX section (§9) requires Ink
  specifically; "beautiful, colorful, tabular output" and "helpful errors"
  are both satisfied by the current stack.
