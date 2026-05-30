import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HealthScore } from "../lib/types.js";
import { formatClock } from "../lib/format.js";

interface HealthHistoryChartProps {
  scores: HealthScore[];
}

export function HealthHistoryChart({ scores }: HealthHistoryChartProps) {
  if (scores.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-border bg-panel text-sm text-text-muted">
        Not enough history yet — each `report` run (or a call to /health) records one point.
      </div>
    );
  }

  const data = scores.map((s) => ({ windowEnd: s.windowEnd, score: s.score }));

  return (
    <div className="h-48 rounded-lg border border-border bg-panel p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -20 }}>
          <XAxis
            dataKey="windowEnd"
            tickFormatter={formatClock}
            stroke="#7d8590"
            fontSize={11}
            fontFamily="ui-monospace, monospace"
            tickLine={false}
            axisLine={{ stroke: "#232b33" }}
          />
          <YAxis
            domain={[0, 100]}
            stroke="#7d8590"
            fontSize={11}
            fontFamily="ui-monospace, monospace"
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              background: "#12181f",
              border: "1px solid #232b33",
              borderRadius: 6,
              fontFamily: "ui-monospace, monospace",
              fontSize: 12
            }}
            labelFormatter={(value) => formatClock(Number(value))}
            formatter={(value) => [typeof value === "number" ? value.toFixed(1) : String(value), "score"]}
          />
          <Line type="monotone" dataKey="score" stroke="#58a6ff" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
