import { AutoRefresh } from "@/components/auto-refresh";
import { IncidentTable } from "@/components/incidents/incident-table";
import { Card } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { listIncidents } from "@uptimewatch/domain";
import Link from "next/link";
import { loadOrg } from "../org-context";

export const metadata = { title: "Incidents — UptimeWatch" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
];

export default async function IncidentsPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ status?: string; cursor?: string }> }) {
  const { orgId } = await params;
  const search = await searchParams;
  const { session } = await loadOrg(orgId);
  const status = search.status === "active" || search.status === "resolved" ? search.status : undefined;
  const result = await listIncidents(getDb(), { userId: session.user.id }, orgId, {
    ...(status ? { status } : {}),
    ...(search.cursor ? { cursor: search.cursor } : {}),
  }).catch(() => listIncidents(getDb(), { userId: session.user.id }, orgId, {}));

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Incidents</h1>
      <p className="mt-1 text-sm text-neutral-400">Opened after two consecutive failed checks, resolved after two successful ones.</p>
      <nav className="mt-6 flex gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `?status=${f.value}` : "?"}
            className={`rounded-md px-3 py-1.5 ${(status ?? "") === f.value ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-100"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <Card className="mt-4 overflow-x-auto p-0">
        {result.data.length === 0 ? (
          <p className="px-6 py-12 text-center text-neutral-400">{status === "active" ? "No active incidents. All systems operational." : "No incidents yet."}</p>
        ) : (
          <IncidentTable orgId={orgId} incidents={result.data} />
        )}
      </Card>
      {result.nextCursor && (
        <div className="mt-4 flex justify-end text-sm">
          <Link href={`?${new URLSearchParams({ ...(status ? { status } : {}), cursor: result.nextCursor })}`} className="hover:underline">Older incidents →</Link>
        </div>
      )}
      <AutoRefresh seconds={20} />
    </div>
  );
}
