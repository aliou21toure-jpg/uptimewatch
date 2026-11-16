import { AutoRefresh } from "@/components/auto-refresh";
import { AcknowledgeButton, UpdateForm } from "@/components/incidents/incident-actions";
import { causeLabel, formatDuration, IncidentBadge } from "@/components/incidents/incident-badge";
import { Card } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { can, DomainError, getIncident } from "@uptimewatch/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOrg } from "../../org-context";

const UPDATE_LABEL = { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved" } as const;
const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });

export default async function IncidentPage({ params }: { params: Promise<{ orgId: string; incidentId: string }> }) {
  const { orgId, incidentId } = await params;
  const { session, org } = await loadOrg(orgId);
  const incident = await getIncident(getDb(), { userId: session.user.id }, orgId, incidentId).catch((error) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const active = incident.status !== "resolved";
  const canWrite = can(org.role, "incident:write");

  const facts: [string, string][] = [
    ["Started", fmt(incident.openedAt)],
    ["Confirmed", fmt(incident.detectedAt)],
    ["Resolved", incident.resolvedAt ? fmt(incident.resolvedAt) : "—"],
    ["Duration", `${formatDuration(incident.openedAt, incident.resolvedAt)}${active ? " (ongoing)" : ""}`],
    ["Failed checks", String(incident.failedCheckCount)],
    ["Acknowledged", incident.acknowledgedAt ? `${fmt(incident.acknowledgedAt)}${incident.acknowledgedByName ? ` by ${incident.acknowledgedByName}` : ""}` : "—"],
  ];

  return (
    <div className="max-w-4xl">
      <Link href={`/app/${orgId}/incidents`} className="text-sm text-neutral-400 hover:text-neutral-100">← Incidents</Link>
      <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{incident.title}</h1>
            <IncidentBadge status={incident.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            <Link href={`/app/${orgId}/monitors/${incident.monitorId}`} className="hover:text-neutral-100">{incident.monitorName}</Link>
            {" · "}{causeLabel(incident.causeCode)}
          </p>
        </div>
        {canWrite && incident.status === "open" && <AcknowledgeButton orgId={orgId} incidentId={incidentId} />}
      </div>

      {incident.causeMessage && (
        <Card className="mt-6 border-red-500/20 bg-red-500/5">
          <p className="text-sm text-red-200"><span className="font-medium">Detected cause:</span> {incident.causeMessage}</p>
        </Card>
      )}

      <Card className="mt-4">
        <dl className="grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex gap-4">
              <dt className="w-32 shrink-0 text-neutral-400">{k}</dt>
              <dd className="text-neutral-100">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mt-4">
        <h2 className="mb-4 font-medium">Timeline</h2>
        <ol className="relative flex flex-col gap-5 border-l border-neutral-800 pl-5">
          {incident.updates.map((u) => (
            <li key={u.id} className="relative">
              <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${u.status === "resolved" ? "bg-emerald-400" : "bg-neutral-500"}`} />
              <p className="text-sm"><span className="font-medium text-neutral-100">{UPDATE_LABEL[u.status]}</span>
                <span className="text-neutral-500"> · {fmt(u.createdAt)} · {u.authorName ?? "UptimeWatch"}</span></p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-300">{u.message}</p>
            </li>
          ))}
        </ol>
        {canWrite && active && (
          <div className="mt-6 border-t border-neutral-800 pt-6">
            <UpdateForm orgId={orgId} incidentId={incidentId} />
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <h2 className="mb-3 font-medium">Notifications</h2>
        {incident.deliveries.length === 0 ? (
          <p className="text-sm text-neutral-400">No email sent yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {incident.deliveries.map((d, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="text-neutral-300">{d.eventType === "incident.opened" ? "Outage alert" : "Recovery notice"} → {d.recipientName}</span>
                <span className={d.status === "sent" ? "text-emerald-300" : d.status === "failed" ? "text-red-400" : "text-amber-300"}>
                  {d.status === "sent" ? `Sent ${d.sentAt ? fmt(d.sentAt) : ""}` : d.status === "failed" ? `Failed after ${d.attempts} attempts` : `Pending (attempt ${d.attempts})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {active && <AutoRefresh seconds={15} />}
    </div>
  );
}
