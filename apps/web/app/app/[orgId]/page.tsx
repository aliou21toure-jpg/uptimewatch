import { formatDowntime, formatMs, formatPercent } from "@/components/analytics/format";
import { AutoRefresh } from "@/components/auto-refresh";
import { UptimeStrip } from "@/components/charts/uptime-strip";
import { causeLabel } from "@/components/incidents/incident-badge";
import { formatRelative, StateBadge } from "@/components/monitors/state-badge";
import { Card } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { can, organizationDashboard } from "@uptimewatch/domain";
import Link from "next/link";
import { loadOrg } from "./org-context";

export const metadata = { title: "Dashboard — UptimeWatch" };

export default async function Dashboard({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { session, org } = await loadOrg(orgId);
  const d = await organizationDashboard(getDb(), { userId: session.user.id }, orgId);
  const w = d.windows;

  const tiles: { label: string; value: string; hint: string; tone?: "bad" }[] = [
    { label: "Uptime · 24 h", value: formatPercent(w["24h"].uptime), hint: `downtime ${formatDowntime(w["24h"].downtimeSeconds)}` },
    { label: "Uptime · 30 days", value: formatPercent(w["30d"].uptime), hint: `${w["30d"].incidents} incident${w["30d"].incidents === 1 ? "" : "s"} · 7 d ${formatPercent(w["7d"].uptime)}` },
    { label: "Avg. response · 24 h", value: formatMs(w["24h"].avgLatencyMs), hint: `P95 ${formatMs(w["24h"].p95LatencyMs)}` },
    {
      label: "Monitors",
      value: `${d.counts.active}`,
      hint: d.counts.down ? `${d.counts.down} down · ${d.counts.openIncidents} open incident${d.counts.openIncidents === 1 ? "" : "s"}` : `all up${d.counts.total > d.counts.active ? ` · ${d.counts.total - d.counts.active} paused` : ""}`,
      ...(d.counts.down ? { tone: "bad" as const } : {}),
    },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {org.memberCount} {org.memberCount === 1 ? "member" : "members"} · coverage 24 h {formatPercent(w["24h"].coverage, 1)}
          </p>
        </div>
        <p className="text-xs text-neutral-500">Updated {d.generatedAt.toLocaleTimeString("en-GB")} · refreshes every 30 s</p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="p-5">
            <p className="text-sm text-neutral-400">{t.label}</p>
            <p className={`mt-2 text-3xl font-semibold tabular-nums ${t.tone === "bad" ? "text-red-400" : ""}`}>{t.value}</p>
            <p className="mt-1 text-xs text-neutral-500">{t.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <h2 className="mb-4 text-sm font-medium">All monitors, last 30 days</h2>
        <UptimeStrip days={d.daily} label="Daily uptime across all monitors over the last 30 days" />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="overflow-x-auto p-0 lg:col-span-2">
          <div className="flex items-center justify-between px-6 pt-5">
            <h2 className="text-sm font-medium">Monitors</h2>
            {can(org.role, "monitor:write") && (
              <Link href={`/app/${orgId}/monitors/new`} className="text-sm text-emerald-400 hover:underline">Add monitor</Link>
            )}
          </div>
          {d.monitors.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-neutral-400">No monitors yet.</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead className="text-neutral-400">
                <tr>
                  <th className="px-6 py-2 font-medium">Monitor</th>
                  <th className="px-6 py-2 text-right font-medium sm:px-3">24 h</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">30 d</th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Avg / P95</th>
                  <th className="hidden px-6 py-2 text-right font-medium lg:table-cell">Checked</th>
                </tr>
              </thead>
              <tbody>
                {d.monitors.map((m) => (
                  <tr key={m.id} className="border-t border-neutral-800 hover:bg-neutral-900">
                    <td className="px-6 py-2.5">
                      <Link href={`/app/${orgId}/monitors/${m.id}`} className="font-medium text-neutral-100 hover:underline">{m.name}</Link>
                      <div className="mt-0.5"><StateBadge state={m.state} /></div>
                    </td>
                    <td className="px-6 py-2.5 text-right tabular-nums sm:px-3">{formatPercent(m.uptime24h)}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{formatPercent(m.uptime30d)}</td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-neutral-300 md:table-cell">
                      {m.avgLatency24h === null ? "—" : `${m.avgLatency24h} / ${m.p95Latency24h} ms`}
                    </td>
                    <td className="hidden whitespace-nowrap px-6 py-2.5 text-right text-neutral-400 lg:table-cell">{formatRelative(m.lastCheckedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium">Latest events</h2>
          {d.events.length === 0 ? (
            <p className="text-sm text-neutral-400">Nothing to report.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {d.events.map((e) => (
                <li key={`${e.type}-${e.incidentId}`} className="flex gap-3 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.type === "opened" ? "bg-red-500" : "bg-emerald-400"}`} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/app/${orgId}/incidents/${e.incidentId}`} className="text-neutral-100 hover:underline">
                      {e.monitorName} {e.type === "opened" ? "went down" : "recovered"}
                    </Link>
                    <p className="text-xs text-neutral-500">
                      {formatRelative(e.at)}{e.type === "opened" ? ` · ${causeLabel(e.causeCode)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
      <AutoRefresh seconds={30} />
    </div>
  );
}
