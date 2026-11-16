import { AutoRefresh } from "@/components/auto-refresh";
import { CheckHistory } from "@/components/monitors/check-history";
import { MonitorActions } from "@/components/monitors/monitor-actions";
import { formatInterval, formatRelative, StateBadge } from "@/components/monitors/state-badge";
import { Card } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { can, listChecks } from "@uptimewatch/domain";
import Link from "next/link";
import { loadOrg } from "../../org-context";
import { loadMonitor } from "./monitor-data";

export default async function MonitorPage({ params }: { params: Promise<{ orgId: string; monitorId: string }> }) {
  const { orgId, monitorId } = await params;
  const { org, monitor: m } = await loadMonitor(orgId, monitorId);
  const { session } = await loadOrg(orgId);
  const { data: checks } = await listChecks(getDb(), { userId: session.user.id }, orgId, monitorId, { limit: 60 });

  const settings: [string, string][] = [
    ["Method", m.method],
    ["Interval", formatInterval(m.intervalSeconds)],
    ["Timeout", `${m.timeoutMs / 1000}s`],
    ["Accepted status", `${m.expectedStatusMin}–${m.expectedStatusMax}`],
    ["Keyword", m.bodyContains ?? "—"],
    ["Custom headers", m.headerNames.length ? m.headerNames.join(", ") : "—"],
  ];
  const timeline: [string, string][] = [
    ["Last check", formatRelative(m.lastCheckedAt)],
    ["Last success", formatRelative(m.lastSuccessAt)],
    ["Next check", m.enabled ? formatRelative(m.nextCheckAt) : "Paused"],
    ["Created", m.createdAt.toLocaleDateString("en-GB")],
  ];

  return (
    <div className="max-w-5xl">
      <Link href={`/app/${orgId}/monitors`} className="text-sm text-neutral-400 hover:text-neutral-100">← Monitors</Link>
      <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-semibold">{m.name}</h1>
            <StateBadge state={m.state} />
          </div>
          <a href={m.url} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate font-mono text-sm text-neutral-400 hover:text-neutral-200">
            {m.url}
          </a>
        </div>
        {can(org.role, "monitor:write") && <MonitorActions orgId={orgId} monitorId={m.id} enabled={m.enabled} name={m.name} />}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-medium">Configuration</h2>
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            {settings.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-neutral-400">{k}</dt>
                <dd className="truncate text-neutral-100">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <h2 className="mb-4 font-medium">Activity</h2>
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            {timeline.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-neutral-400">{k}</dt>
                <dd className="text-neutral-100">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      <Card className="mt-4">
        <h2 className="mb-4 font-medium">Recent checks</h2>
        <CheckHistory checks={checks} />
      </Card>
      <AutoRefresh seconds={15} />
    </div>
  );
}
