import { ERROR_LABELS, type CheckErrorCode } from "@uptimewatch/monitoring/errors";
import { formatRelative } from "./state-badge";

export interface CheckRow {
  id: string;
  scheduledFor: Date;
  state: "queued" | "running" | "up" | "down" | "error" | "skipped";
  httpStatus: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const RESULT: Record<CheckRow["state"], { label: string; cls: string }> = {
  up: { label: "Up", cls: "bg-emerald-400" },
  down: { label: "Down", cls: "bg-red-500" },
  error: { label: "Platform error", cls: "bg-neutral-500" },
  skipped: { label: "Skipped", cls: "bg-neutral-700" },
  queued: { label: "Queued", cls: "bg-neutral-600" },
  running: { label: "Running", cls: "bg-sky-400" },
};

const PLATFORM_CODES: Record<string, string> = {
  ENGINE_ERROR: "Check engine error (not counted as downtime)",
  LEASE_EXPIRED: "Check did not complete (not counted as downtime)",
  STALE: "Skipped: the platform was behind schedule",
  MONITOR_PAUSED: "Skipped: monitor paused",
  ENGINE_NOT_ENABLED: "Skipped: check engine not enabled yet",
};

function describe(c: CheckRow): string {
  if (!c.errorCode) return "";
  const label = ERROR_LABELS[c.errorCode as CheckErrorCode] ?? PLATFORM_CODES[c.errorCode] ?? c.errorCode;
  if (!c.errorMessage || c.errorMessage === label) return label;
  return c.errorMessage.toLowerCase().startsWith(label.toLowerCase()) ? c.errorMessage : `${label} — ${c.errorMessage}`;
}

/** Last results as a strip (oldest → newest) plus a detailed table. */
export function CheckHistory({ checks }: { checks: CheckRow[] }) {
  if (checks.length === 0) {
    return <p className="text-sm text-neutral-400">No checks yet. The first one runs within a few seconds of creation.</p>;
  }
  const strip = [...checks].reverse();
  const finished = checks.filter((c) => c.state === "up" || c.state === "down");
  const latencies = finished.filter((c) => c.latencyMs !== null && c.state === "up").map((c) => c.latencyMs!);
  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const upShare = finished.length ? (100 * finished.filter((c) => c.state === "up").length) / finished.length : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex h-8 items-end gap-0.5" aria-label="Recent check results, oldest to newest">
          {strip.map((c) => (
            <span
              key={c.id}
              title={`${c.scheduledFor.toLocaleString("en-GB")} — ${RESULT[c.state].label}${c.httpStatus ? ` ${c.httpStatus}` : ""}`}
              className={`h-full w-1.5 rounded-sm ${RESULT[c.state].cls}`}
            />
          ))}
        </div>
        <dl className="flex gap-6 text-sm">
          <div><dt className="text-neutral-500">Up (recent)</dt><dd className="font-medium">{upShare === null ? "—" : `${upShare.toFixed(1)}%`}</dd></div>
          <div><dt className="text-neutral-500">Avg. response</dt><dd className="font-medium">{avg === null ? "—" : `${avg} ms`}</dd></div>
        </dl>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-400">
            <tr>
              <th className="py-2 pr-4 font-medium">Time</th>
              <th className="py-2 pr-4 font-medium">Result</th>
              <th className="py-2 pr-4 font-medium">HTTP</th>
              <th className="py-2 pr-4 font-medium">Response</th>
              <th className="py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} className="border-t border-neutral-800">
                <td className="whitespace-nowrap py-2 pr-4 text-neutral-400" title={c.scheduledFor.toISOString()}>{formatRelative(c.scheduledFor)}</td>
                <td className="whitespace-nowrap py-2 pr-4">
                  <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${RESULT[c.state].cls}`} />{RESULT[c.state].label}</span>
                </td>
                <td className="py-2 pr-4 font-mono">{c.httpStatus ?? "—"}</td>
                <td className="whitespace-nowrap py-2 pr-4">{c.latencyMs === null ? "—" : `${c.latencyMs} ms`}</td>
                <td className="max-w-md truncate py-2 text-neutral-400" title={describe(c)}>{describe(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
