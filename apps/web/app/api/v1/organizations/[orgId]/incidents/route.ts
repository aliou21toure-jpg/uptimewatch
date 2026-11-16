import { authenticated } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { listIncidents } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated<{ orgId: string }>(async ({ req, actor, params }) =>
  Response.json(await listIncidents(getDb(), actor, params.orgId, Object.fromEntries(new URL(req.url).searchParams))),
);
