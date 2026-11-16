import { authenticated, readJson } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { deleteMonitor, getMonitor, updateMonitor } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

type Params = { orgId: string; monitorId: string };

export const GET = authenticated<Params>(async ({ actor, params }) =>
  Response.json({ data: await getMonitor(getDb(), actor, params.orgId, params.monitorId) }),
);

export const PATCH = authenticated<Params>(async ({ req, actor, params }) =>
  Response.json({ data: await updateMonitor(getDb(), actor, params.orgId, params.monitorId, await readJson(req)) }),
);

export const DELETE = authenticated<Params>(async ({ actor, params }) => {
  await deleteMonitor(getDb(), actor, params.orgId, params.monitorId);
  return new Response(null, { status: 204 });
});
