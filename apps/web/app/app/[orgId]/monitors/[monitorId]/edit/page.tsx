import { MonitorForm } from "@/components/monitors/monitor-form";
import { Card } from "@/components/ui/primitives";
import { can } from "@uptimewatch/domain";
import { redirect } from "next/navigation";
import { loadMonitor } from "../monitor-data";

export default async function EditMonitorPage({ params }: { params: Promise<{ orgId: string; monitorId: string }> }) {
  const { orgId, monitorId } = await params;
  const { org, monitor } = await loadMonitor(orgId, monitorId);
  if (!can(org.role, "monitor:write")) redirect(`/app/${orgId}/monitors/${monitorId}`);
  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">Edit {monitor.name}</h1>
      <Card>
        <MonitorForm
          orgId={orgId}
          monitorId={monitorId}
          initial={{
            name: monitor.name,
            url: monitor.url,
            method: monitor.method,
            intervalSeconds: monitor.intervalSeconds,
            timeoutMs: monitor.timeoutMs,
            expectedStatusMin: monitor.expectedStatusMin,
            expectedStatusMax: monitor.expectedStatusMax,
            bodyContains: monitor.bodyContains,
            headerNames: monitor.headerNames,
          }}
        />
      </Card>
    </div>
  );
}
