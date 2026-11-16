import Link from "next/link";
import { causeLabel, formatDuration, IncidentBadge } from "./incident-badge";

export interface IncidentRow {
  id: string;
  monitorName: string;
  status: "open" | "acknowledged" | "resolved";
  openedAt: Date;
  resolvedAt: Date | null;
  causeCode: string | null;
  failedCheckCount: number;
}

export function IncidentTable({ orgId, incidents, showMonitor = true }: { orgId: string; incidents: IncidentRow[]; showMonitor?: boolean }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-neutral-800 text-neutral-400">
        <tr>
          <th className="px-6 py-3 font-medium">Status</th>
          {showMonitor && <th className="px-6 py-3 font-medium">Monitor</th>}
          <th className="px-6 py-3 font-medium">Cause</th>
          <th className="px-6 py-3 font-medium">Started</th>
          <th className="px-6 py-3 font-medium">Duration</th>
        </tr>
      </thead>
      <tbody>
        {incidents.map((i) => (
          <tr key={i.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900">
            <td className="px-6 py-3"><IncidentBadge status={i.status} /></td>
            {showMonitor && (
              <td className="px-6 py-3">
                <Link href={`/app/${orgId}/incidents/${i.id}`} className="font-medium text-neutral-100 hover:underline">{i.monitorName}</Link>
              </td>
            )}
            <td className="px-6 py-3 text-neutral-300">
              {showMonitor ? causeLabel(i.causeCode) : <Link href={`/app/${orgId}/incidents/${i.id}`} className="hover:underline">{causeLabel(i.causeCode)}</Link>}
            </td>
            <td className="whitespace-nowrap px-6 py-3 text-neutral-400">{i.openedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
            <td className="whitespace-nowrap px-6 py-3 text-neutral-300">{formatDuration(i.openedAt, i.resolvedAt)}{!i.resolvedAt && " (ongoing)"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
