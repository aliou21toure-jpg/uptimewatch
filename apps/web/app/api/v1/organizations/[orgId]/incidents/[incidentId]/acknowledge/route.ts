import { authenticated } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { acknowledgeIncident } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const POST = authenticated<{ orgId: string; incidentId: string }>(async ({ actor, params }) =>
  Response.json({ data: await acknowledgeIncident(getDb(), actor, params.orgId, params.incidentId) }),
);
