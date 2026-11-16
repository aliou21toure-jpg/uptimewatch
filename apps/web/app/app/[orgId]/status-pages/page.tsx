import { Card } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { can, listStatusPages } from "@uptimewatch/domain";
import Link from "next/link";
import { loadOrg } from "../org-context";
import { CreateStatusPageForm } from "./create-form";

export const metadata = { title: "Status pages — UptimeWatch" };

export default async function StatusPagesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { session, org } = await loadOrg(orgId);
  const pages = await listStatusPages(getDb(), { userId: session.user.id }, orgId);
  const canWrite = can(org.role, "status-page:write");

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Status pages</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Public pages that show your customers the state of your services. Only component names, status, uptime and incident
        updates are published — never URLs or headers.
      </p>
      {canWrite && (
        <Card className="mt-8">
          <h2 className="mb-4 font-medium">New status page</h2>
          <CreateStatusPageForm orgId={orgId} />
        </Card>
      )}
      <Card className="mt-6 p-0">
        {pages.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-400">No status page yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {pages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div>
                  <Link href={`/app/${orgId}/status-pages/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                  <p className="text-xs text-neutral-500">
                    /status/{p.slug} · {p.components} component{p.components === 1 ? "" : "s"} · {p.isPublic ? "Public" : "Private"}
                  </p>
                </div>
                {p.isPublic && (
                  <a href={`/status/${p.slug}`} target="_blank" rel="noopener" className="text-sm text-emerald-400 hover:underline">
                    Open public page ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
