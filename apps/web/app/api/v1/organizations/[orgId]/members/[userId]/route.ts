import { authenticated, readJson } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { removeMember, updateMemberRole } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

type Params = { orgId: string; userId: string };

export const PATCH = authenticated<Params>(async ({ req, actor, params }) => {
  const member = await updateMemberRole(getDb(), actor, params.orgId, params.userId, await readJson(req));
  return Response.json({ data: member });
});

export const DELETE = authenticated<Params>(async ({ actor, params }) => {
  await removeMember(getDb(), actor, params.orgId, params.userId);
  return new Response(null, { status: 204 });
});
