import { Card } from "@/components/ui/primitives";
import { loadOrg } from "./org-context";

export default async function OrgOverview({ params }: { params: Promise<{ orgId: string }> }) {
  const { org } = await loadOrg((await params).orgId);
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">{org.name}</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Your role: <span className="text-neutral-200">{org.role}</span> · {org.memberCount}{" "}
        {org.memberCount === 1 ? "member" : "members"}
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {["Global uptime", "Active monitors", "Open incidents"].map((label) => (
          <Card key={label}>
            <p className="text-sm text-neutral-400">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-500">—</p>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <p className="text-sm text-neutral-400">
          No monitors yet. Monitor management arrives in the next release.
        </p>
      </Card>
    </div>
  );
}
