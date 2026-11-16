import { authenticated, readJson } from "@/lib/api";
import { sendInvitationEmail } from "@/lib/invitations";
import { getDb } from "@uptimewatch/db";
import { createInvitation, listPendingInvitations } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated<{ orgId: string }>(async ({ actor, params }) =>
  Response.json({ data: await listPendingInvitations(getDb(), actor, params.orgId) }),
);

export const POST = authenticated<{ orgId: string }>(async ({ req, actor, user, params }) => {
  const { invitation, token, organizationName } = await createInvitation(
    getDb(),
    actor,
    params.orgId,
    (await readJson(req)),
  );
  let emailSent = true;
  try {
    await sendInvitationEmail({
      to: invitation.email,
      token,
      organizationName,
      inviterName: user.name,
      role: invitation.role,
    });
  } catch (error) {
    // The invitation exists; the inviter can resend it. The token itself is never logged.
    emailSent = false;
    console.error("[invitations] email delivery failed:", error instanceof Error ? error.message : "unknown");
  }
  return Response.json({ data: { ...invitation, emailSent } }, { status: 201 });
});
