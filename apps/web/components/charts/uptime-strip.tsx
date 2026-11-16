import { formatPercent, uptimeLevel } from "../analytics/format";

export interface DayPoint {
  day: string;
  checks: number;
  failed: number;
  uptime: number | null;
}

const LEGEND = [99.95, 99.5, 97, 50, null].map((v) => uptimeLevel(v));

/**
 * 30-day status strip: one bar per UTC day colored by the uptime level. Every bar is focusable and
 * carries its values in a tooltip; the legend names each color, and the table view sits below.
 */
export function UptimeStrip({
  days,
  label,
  showCounts = true,
  showLegend = true,
}: {
  days: DayPoint[];
  label: string;
  showCounts?: boolean;
  showLegend?: boolean;
}) {
  return (
    <figure>
      <figcaption className="sr-only">{label}</figcaption>
      <div className={`flex items-stretch ${days.length > 45 ? "h-8 gap-px" : "h-10 gap-[2px]"}`} role="list" aria-label={label}>
        {days.map((d) => {
          const level = uptimeLevel(d.checks ? d.uptime : null);
          const text = `${new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}: ${
            d.checks ? `${formatPercent(d.uptime)} uptime${showCounts ? `, ${d.failed} failed of ${d.checks} checks` : ""}` : "no data"
          }`;
          return (
            <div
              key={d.day}
              role="listitem"
              tabIndex={0}
              aria-label={text}
              className="group relative min-w-0 flex-1 rounded-[2px] outline-none transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-neutral-300"
              style={{ backgroundColor: level.color }}
            >
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-max max-w-56 -translate-x-1/2 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 shadow-lg group-hover:block group-focus-visible:block">
                {text} · {level.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-neutral-500">
        <span>{days.length} days ago</span>
        <span>Today (UTC)</span>
      </div>
      {showLegend && <UptimeLegend />}
    </figure>
  );
}

export function UptimeLegend() {
  return (
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden />
            {l.label}
            <span className="text-neutral-600">
              {l.label === "Operational" ? "≥ 99.9%" : l.label === "Minor issues" ? "≥ 99%" : l.label === "Degraded" ? "≥ 95%" : l.label === "Major outage" ? "< 95%" : ""}
            </span>
          </li>
        ))}
      </ul>
  );
}
