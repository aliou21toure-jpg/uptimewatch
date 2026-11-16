import { authenticated } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { resumeMonitor } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const POST = authenticated<{ orgId: string; monitorId: string }>(async ({ actor, params }) =>
  Response.json({ data: await resumeMonitor(getDb(), actor, params.orgId, params.monitorId) }),
);
