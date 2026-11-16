import { authenticated } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { revokeInvitation } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const DELETE = authenticated<{ orgId: string; invitationId: string }>(async ({ actor, params }) => {
  await revokeInvitation(getDb(), actor, params.orgId, params.invitationId);
  return new Response(null, { status: 204 });
});
