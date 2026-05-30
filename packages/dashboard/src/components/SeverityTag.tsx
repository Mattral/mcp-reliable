import { severityTextClass } from "../lib/format.js";

export function SeverityTag({ severity }: { severity: string }) {
  return (
    <span className={`font-mono text-xs font-medium uppercase tracking-wide ${severityTextClass(severity)}`}>
      {severity}
    </span>
  );
}
