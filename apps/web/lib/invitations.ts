import "server-only";
import { getWebEnv } from "@uptimewatch/config";
import { actionEmail, getEmailSender } from "@uptimewatch/email";

export async function sendInvitationEmail(input: {
  to: string;
  token: string;
  organizationName: string;
  inviterName: string;
  role: string;
}) {
  const url = new URL("/invitations/accept", getWebEnv().APP_URL);
  url.searchParams.set("token", input.token);
  await getEmailSender().send(
    actionEmail({
      to: input.to,
      subject: `${input.inviterName} invited you to ${input.organizationName} on UptimeWatch`,
      intro: `${input.inviterName} invited you to join ${input.organizationName} as ${input.role}. The invitation expires in 7 days.`,
      actionLabel: "Accept the invitation",
      url: url.toString(),
    }),
  );
}
