import { authenticated } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { listMembers } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated<{ orgId: string }>(async ({ actor, params }) =>
  Response.json({ data: await listMembers(getDb(), actor, params.orgId) }),
);
