import { authenticated, readJson } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { getNotificationPreferences, updateNotificationPreferences } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

/** The signed-in user's own alert settings for this organization. */
export const GET = authenticated<{ orgId: string }>(async ({ actor, params }) =>
  Response.json({ data: await getNotificationPreferences(getDb(), actor, params.orgId) }),
);

export const PATCH = authenticated<{ orgId: string }>(async ({ req, actor, params }) =>
  Response.json({ data: await updateNotificationPreferences(getDb(), actor, params.orgId, await readJson(req)) }),
);
