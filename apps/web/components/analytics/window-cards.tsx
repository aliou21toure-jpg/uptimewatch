import type { WindowStats } from "@uptimewatch/domain";
import { formatDowntime, formatMs, formatPercent } from "./format";

const LABELS = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" } as const;

/** Uptime for the three windows, each with the evidence behind the number. */
export function WindowCards({ windows }: { windows: Record<"24h" | "7d" | "30d", WindowStats> }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => {
        const w = windows[key];
        return (
          <div key={key} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-5">
            <p className="text-sm text-neutral-400">{LABELS[key]}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{formatPercent(w.uptime)}</p>
            <p className="mt-1 text-xs text-neutral-500">uptime · {w.checks.toLocaleString("en")} checks</p>
            <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-neutral-400">Incidents</dt>
              <dd className="text-right tabular-nums">{w.incidents}</dd>
              <dt className="text-neutral-400">Downtime</dt>
              <dd className="text-right tabular-nums">{formatDowntime(w.downtimeSeconds)}</dd>
              <dt className="text-neutral-400">Avg. response</dt>
              <dd className="text-right tabular-nums">{formatMs(w.avgLatencyMs)}</dd>
              {key === "24h" && (
                <>
                  <dt className="text-neutral-400">P50 / P95</dt>
                  <dd className="text-right tabular-nums">{w.p50LatencyMs === null ? "—" : `${w.p50LatencyMs} / ${w.p95LatencyMs} ms`}</dd>
                </>
              )}
              <dt className="text-neutral-400" title="Share of planned checks the platform executed. Below 100% means some periods were not observed.">
                Coverage
              </dt>
              <dd className="text-right tabular-nums">{formatPercent(w.coverage, 1)}</dd>
            </dl>
          </div>
        );
      })}
    </div>
  );
}
