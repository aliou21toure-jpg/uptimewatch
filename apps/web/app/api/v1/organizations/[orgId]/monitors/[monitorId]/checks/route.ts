import { authenticated } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { listChecks } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated<{ orgId: string; monitorId: string }>(async ({ req, actor, params }) => {
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return Response.json(await listChecks(getDb(), actor, params.orgId, params.monitorId, query));
});
