import { authenticated } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { organizationDashboard } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated<{ orgId: string }>(async ({ actor, params }) =>
  Response.json({ data: await organizationDashboard(getDb(), actor, params.orgId) }),
);
