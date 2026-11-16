import { authenticated, readJson } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { createMonitor, listMonitors } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated<{ orgId: string }>(async ({ req, actor, params }) => {
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return Response.json(await listMonitors(getDb(), actor, params.orgId, query));
});

export const POST = authenticated<{ orgId: string }>(async ({ req, actor, params }) =>
  Response.json({ data: await createMonitor(getDb(), actor, params.orgId, await readJson(req)) }, { status: 201 }),
);
