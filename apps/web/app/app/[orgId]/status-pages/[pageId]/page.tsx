import { Card } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { can, DomainError, getStatusPage, listMonitors } from "@uptimewatch/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOrg } from "../../org-context";
import { ComponentsEditor, DeletePageButton, PageSettingsForm } from "./editor";

export default async function StatusPageEditor({ params }: { params: Promise<{ orgId: string; pageId: string }> }) {
  const { orgId, pageId } = await params;
  const { session, org } = await loadOrg(orgId);
  const actor = { userId: session.user.id };
  const page = await getStatusPage(getDb(), actor, orgId, pageId).catch((error) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const canWrite = can(org.role, "status-page:write");
  const { data: monitors } = await listMonitors(getDb(), actor, orgId, { limit: 100 });

  return (
    <div className="max-w-4xl">
      <Link href={`/app/${orgId}/status-pages`} className="text-sm text-neutral-400 hover:text-neutral-100">← Status pages</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{page.title}</h1>
          <p className="mt-1 text-sm text-neutral-400">/status/{page.slug} · {page.isPublic ? "Public" : "Private (only members can preview it)"}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/app/${orgId}/status-pages/${pageId}/preview`} className="inline-flex h-9 items-center rounded-md border border-neutral-700 px-4 text-sm hover:bg-neutral-800">Preview</Link>
          {page.isPublic && (
            <a href={`/status/${page.slug}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center rounded-md bg-emerald-500 px-4 text-sm font-medium text-neutral-950 hover:bg-emerald-400">
              Open public page ↗
            </a>
          )}
        </div>
      </div>

      <Card className="mt-8">
        <h2 className="mb-1 font-medium">Components</h2>
        <p className="mb-4 text-sm text-neutral-400">
          Monitors shown on the page, in order. Give them a public name to keep internal names private. Incident updates
          posted on these monitors are published on the page.
        </p>
        <ComponentsEditor
          orgId={orgId}
          pageId={pageId}
          canWrite={canWrite}
          initial={page.components.map((c) => ({ monitorId: c.monitorId, displayName: c.displayName ?? "", monitorName: c.monitorName }))}
          monitors={monitors.map((m) => ({ id: m.id, name: m.name }))}
        />
      </Card>

      {canWrite && (
        <>
          <Card className="mt-6">
            <h2 className="mb-4 font-medium">Settings</h2>
            <PageSettingsForm orgId={orgId} pageId={pageId} initial={{ title: page.title, slug: page.slug, description: page.description ?? "", isPublic: page.isPublic }} />
          </Card>
          <Card className="mt-6 border-red-500/20">
            <h2 className="mb-2 font-medium">Delete this page</h2>
            <p className="mb-4 text-sm text-neutral-400">The public URL stops working immediately. Monitors are not affected.</p>
            <DeletePageButton orgId={orgId} pageId={pageId} title={page.title} />
          </Card>
        </>
      )}
    </div>
  );
}
