import type { PublicStatusPage } from "@uptimewatch/domain";
import { formatPercent } from "../analytics/format";
import { UptimeLegend, UptimeStrip } from "../charts/uptime-strip";

const OVERALL = {
  operational: { label: "All systems operational", icon: "✓", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" },
  degraded: { label: "Degraded performance", icon: "!", cls: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  partial_outage: { label: "Partial outage", icon: "!", cls: "border-orange-500/30 bg-orange-500/10 text-orange-200" },
  major_outage: { label: "Major outage", icon: "✕", cls: "border-red-500/30 bg-red-500/10 text-red-200" },
  unknown: { label: "Status not yet available", icon: "…", cls: "border-neutral-700 bg-neutral-900 text-neutral-300" },
} as const;

const COMPONENT = {
  operational: { label: "Operational", dot: "bg-emerald-400", text: "text-emerald-300" },
  degraded: { label: "Degraded", dot: "bg-amber-400", text: "text-amber-300" },
  outage: { label: "Outage", dot: "bg-red-500", text: "text-red-400" },
  maintenance: { label: "Not monitored", dot: "bg-neutral-500", text: "text-neutral-400" },
  unknown: { label: "Pending", dot: "bg-neutral-500", text: "text-neutral-400" },
} as const;

const UPDATE = { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved" } as const;
const fmt = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/** The public status page. Renders only the allow-listed projection from getPublicStatusPage. */
export function PublicStatusView({ page }: { page: PublicStatusPage }) {
  const overall = OVERALL[page.overall];
  const ongoing = page.incidents.filter((i) => i.status === "ongoing");
  const past = page.incidents.filter((i) => i.status === "resolved");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
        {page.description && <p className="mt-2 whitespace-pre-line text-neutral-400">{page.description}</p>}
      </header>

      <div className={`mt-8 flex items-center gap-3 rounded-lg border px-5 py-4 ${overall.cls}`} role="status">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-current/10 text-sm font-bold" aria-hidden>
          {overall.icon}
        </span>
        <p className="text-lg font-medium">{overall.label}</p>
      </div>

      {ongoing.length > 0 && (
        <section className="mt-8" aria-labelledby="ongoing">
          <h2 id="ongoing" className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-400">Ongoing incidents</h2>
          <div className="flex flex-col gap-4">{ongoing.map((i) => <IncidentCard key={i.startedAt.toISOString() + i.title} incident={i} />)}</div>
        </section>
      )}

      <section className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/60" aria-labelledby="components">
        <h2 id="components" className="sr-only">Components</h2>
        {page.components.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-400">No components yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {page.components.map((c) => {
              const s = COMPONENT[c.status];
              return (
                <li key={c.name} className="px-5 py-5">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">{c.name}</p>
                    <p className={`flex items-center gap-1.5 text-sm ${s.text}`}>
                      <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
                      {s.label}
                      <span className="text-neutral-500">· {formatPercent(c.uptime90d)} over 90 days</span>
                    </p>
                  </div>
                  <UptimeStrip
                    days={c.days.map((d) => ({ day: d.day, uptime: d.uptime, checks: d.uptime === null ? 0 : 1, failed: 0 }))}
                    label={`Daily uptime of ${c.name} over the last 90 days`}
                    showCounts={false}
                    showLegend={false}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {page.components.length > 0 && <div className="border-t border-neutral-800 px-5 pb-4"><UptimeLegend /></div>}
      </section>

      <section className="mt-10" aria-labelledby="history">
        <h2 id="history" className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-400">Past incidents · 14 days</h2>
        {past.length === 0 ? (
          <p className="text-sm text-neutral-400">No incidents reported.</p>
        ) : (
          <div className="flex flex-col gap-4">{past.map((i) => <IncidentCard key={i.startedAt.toISOString() + i.title} incident={i} />)}</div>
        )}
      </section>

      <footer className="mt-12 flex flex-wrap justify-between gap-2 border-t border-neutral-800 pt-6 text-xs text-neutral-500">
        <span>Updated {fmt(page.generatedAt)} · refreshed every 30 seconds</span>
        <span>Powered by UptimeWatch</span>
      </footer>
    </div>
  );
}

function IncidentCard({ incident }: { incident: PublicStatusPage["incidents"][number] }) {
  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-5 py-4">
      <h3 className="font-medium">{incident.title}</h3>
      <p className="mt-0.5 text-xs text-neutral-500">
        {fmt(incident.startedAt)}{incident.resolvedAt ? ` – ${fmt(incident.resolvedAt)}` : " · ongoing"}
      </p>
      <ol className="mt-3 flex flex-col gap-3">
        {incident.updates.map((u, i) => (
          <li key={i} className="text-sm">
            <span className="font-medium text-neutral-100">{UPDATE[u.status]}</span>
            <span className="text-neutral-500"> · {fmt(u.at)}</span>
            <p className="mt-0.5 whitespace-pre-wrap text-neutral-300">{u.message}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
