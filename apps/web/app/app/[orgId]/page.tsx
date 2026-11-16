import { AutoRefresh } from "@/components/auto-refresh";
import { Card } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { IncidentTable } from "@/components/incidents/incident-table";
import { can, listIncidents, monitorSummary } from "@uptimewatch/domain";
import Link from "next/link";
import { loadOrg } from "./org-context";

export default async function OrgOverview({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { session, org } = await loadOrg(orgId);
  const actor = { userId: session.user.id };
  const [summary, active] = await Promise.all([
    monitorSummary(getDb(), actor, orgId),
    listIncidents(getDb(), actor, orgId, { status: "active", limit: 10 }),
  ]);
  const down = summary.byState.down ?? 0;

  const tiles: [string, string, string | undefined][] = [
    ["Active monitors", String(summary.active), summary.total > summary.active ? `${summary.total - summary.active} paused` : undefined],
    ["Open incidents", String(active.data.length), down ? `${down} monitor${down > 1 ? "s" : ""} down` : "All clear"],
    ["Global uptime", "—", "Available once checks run"],
  ];

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">{org.name}</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Your role: <span className="text-neutral-200">{org.role}</span> · {org.memberCount}{" "}
        {org.memberCount === 1 ? "member" : "members"}
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {tiles.map(([label, value, hint]) => (
          <Card key={label}>
            <p className="text-sm text-neutral-400">{label}</p>
            <p className="mt-2 text-3xl font-semibold">{value}</p>
            {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
          </Card>
        ))}
      </div>
      {active.data.length > 0 && (
        <Card className="mt-6 overflow-x-auto p-0">
          <h2 className="px-6 pt-5 font-medium">Active incidents</h2>
          <IncidentTable orgId={orgId} incidents={active.data} />
        </Card>
      )}
      <AutoRefresh seconds={20} />
      {summary.total === 0 && (
        <Card className="mt-6">
          <p className="text-sm text-neutral-300">No monitors yet.</p>
          {can(org.role, "monitor:write") && (
            <Link href={`/app/${orgId}/monitors/new`} className="mt-3 inline-flex h-9 items-center rounded-md bg-emerald-500 px-4 text-sm font-medium text-neutral-950 hover:bg-emerald-400">
              Add a monitor
            </Link>
          )}
        </Card>
      )}
    </div>
  );
}
