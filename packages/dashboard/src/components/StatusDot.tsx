interface StatusDotProps {
  /** true = last check succeeded, false = last check failed, null = no check recorded yet */
  reachable: boolean | null;
  /** Pulses to draw the eye when a server needs attention (an unresolved alert). Respects prefers-reduced-motion globally. */
  pulse?: boolean;
}

export function StatusDot({ reachable, pulse }: StatusDotProps) {
  const colorClass = reachable === null ? "bg-text-muted" : reachable ? "bg-good" : "bg-bad";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colorClass} ${pulse ? "animate-pulse" : ""}`}
      role="img"
      aria-label={reachable === null ? "no data" : reachable ? "reachable" : "unreachable"}
    />
  );
}
