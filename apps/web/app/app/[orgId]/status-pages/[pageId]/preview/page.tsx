import { PublicStatusView } from "@/components/status-pages/public-view";
import { getDb } from "@uptimewatch/db";
import { DomainError, previewStatusPage } from "@uptimewatch/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOrg } from "../../../org-context";

export default async function PreviewPage({ params }: { params: Promise<{ orgId: string; pageId: string }> }) {
  const { orgId, pageId } = await params;
  const { session } = await loadOrg(orgId);
  const page = await previewStatusPage(getDb(), { userId: session.user.id }, orgId, pageId).catch((error) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return (
    <div className="-mx-4 -my-6 md:-mx-8 md:-my-8">
      <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-sm text-amber-200">
        Preview — this is exactly what visitors see.{" "}
        <Link href={`/app/${orgId}/status-pages/${pageId}`} className="underline">Back to the editor</Link>
      </div>
      <PublicStatusView page={page} />
    </div>
  );
}
