import { authenticated, readJson } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { addIncidentUpdate } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const POST = authenticated<{ orgId: string; incidentId: string }>(async ({ req, actor, params }) =>
  Response.json({ data: await addIncidentUpdate(getDb(), actor, params.orgId, params.incidentId, await readJson(req)) }, { status: 201 }),
);
