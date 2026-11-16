import { authenticated } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { monitorStats } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated<{ orgId: string; monitorId: string }>(async ({ actor, params }) =>
  Response.json({ data: await monitorStats(getDb(), actor, params.orgId, params.monitorId) }),
);
