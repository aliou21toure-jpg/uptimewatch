import { authenticated, readJson } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { createStatusPage, listStatusPages } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated<{ orgId: string }>(async ({ actor, params }) =>
  Response.json({ data: await listStatusPages(getDb(), actor, params.orgId) }),
);

export const POST = authenticated<{ orgId: string }>(async ({ req, actor, params }) =>
  Response.json({ data: await createStatusPage(getDb(), actor, params.orgId, await readJson(req)) }, { status: 201 }),
);
