import { authenticated } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { getIncident } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated<{ orgId: string; incidentId: string }>(async ({ actor, params }) =>
  Response.json({ data: await getIncident(getDb(), actor, params.orgId, params.incidentId) }),
);
