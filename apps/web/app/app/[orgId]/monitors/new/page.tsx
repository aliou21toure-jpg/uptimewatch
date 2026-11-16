import { MonitorForm } from "@/components/monitors/monitor-form";
import { Card } from "@/components/ui/primitives";
import { can } from "@uptimewatch/domain";
import { redirect } from "next/navigation";
import { loadOrg } from "../../org-context";

export const metadata = { title: "New monitor — UptimeWatch" };

export default async function NewMonitorPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { org } = await loadOrg(orgId);
  if (!can(org.role, "monitor:write")) redirect(`/app/${orgId}/monitors`);
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">New monitor</h1>
      <p className="mt-1 mb-6 text-sm text-neutral-400">
        A check fails on a timeout, a connection or TLS error, an unexpected status code, or a missing keyword.
        Two failures in a row open an incident.
      </p>
      <Card><MonitorForm orgId={orgId} /></Card>
    </div>
  );
}
