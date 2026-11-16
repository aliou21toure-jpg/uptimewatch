import { authenticated, readJson } from "@/lib/api";
import { revalidateStatusPages } from "@/lib/revalidate";
import { getDb } from "@uptimewatch/db";
import { setStatusPageComponents } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

/** Replaces the components of the page, in order: `[{ monitorId, displayName? }]`. */
export const PUT = authenticated<{ orgId: string; pageId: string }>(async ({ req, actor, params }) => {
  const { affectedSlugs } = await setStatusPageComponents(getDb(), actor, params.orgId, params.pageId, await readJson(req));
  revalidateStatusPages(affectedSlugs);
  return new Response(null, { status: 204 });
});
