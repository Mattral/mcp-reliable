import { classifyScore, formatScore } from "../lib/format.js";

const BAR_COLOR_CLASS: Record<string, string> = {
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad"
};

interface ScoreReadoutProps {
  score: number | null;
  sampleCount: number;
  windowLabel: string;
}

export function ScoreReadout({ score, sampleCount, windowLabel }: ScoreReadoutProps) {
  if (score === null) {
    return (
      <div>
        <div className="font-mono text-5xl text-text-muted">—</div>
        <div className="mt-3 h-1 w-40 rounded-full bg-border" />
        <div className="mt-2 max-w-md text-sm text-text-muted">
          No live tool traffic in {windowLabel}. Run this server through{" "}
          <code className="rounded bg-panel-hover px-1 py-0.5 font-mono text-text-primary">mcp-reliable proxy</code>{" "}
          to collect real usage data.
        </div>
      </div>
    );
  }

  const band = classifyScore(score);

  return (
    <div>
      <div className="font-mono text-5xl font-semibold tabular-nums text-text-primary">{formatScore(score)}</div>
      <div className={`mt-3 h-1 w-40 rounded-full ${BAR_COLOR_CLASS[band]}`} />
      <div className="mt-2 text-sm text-text-muted">
        health score · {sampleCount} calls · {windowLabel}
      </div>
    </div>
  );
}
