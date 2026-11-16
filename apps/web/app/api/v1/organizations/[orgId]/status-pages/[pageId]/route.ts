import { authenticated, readJson } from "@/lib/api";
import { revalidateStatusPages } from "@/lib/revalidate";
import { getDb } from "@uptimewatch/db";
import { deleteStatusPage, getStatusPage, updateStatusPage } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

type Params = { orgId: string; pageId: string };

export const GET = authenticated<Params>(async ({ actor, params }) =>
  Response.json({ data: await getStatusPage(getDb(), actor, params.orgId, params.pageId) }),
);

export const PATCH = authenticated<Params>(async ({ req, actor, params }) => {
  const { page, affectedSlugs } = await updateStatusPage(getDb(), actor, params.orgId, params.pageId, await readJson(req));
  revalidateStatusPages(affectedSlugs);
  return Response.json({ data: page });
});

export const DELETE = authenticated<Params>(async ({ actor, params }) => {
  const { affectedSlugs } = await deleteStatusPage(getDb(), actor, params.orgId, params.pageId);
  revalidateStatusPages(affectedSlugs);
  return new Response(null, { status: 204 });
});
