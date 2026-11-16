import { Alert, Card } from "@/components/ui/primitives";
import { getSession } from "@/lib/session";
import { getDb } from "@uptimewatch/db";
import { previewInvitation } from "@uptimewatch/domain";
import Link from "next/link";
import { AcceptButton } from "./accept-button";

export const metadata = { title: "Invitation — UptimeWatch" };
export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const invitation = token && token.length <= 200 ? await previewInvitation(getDb(), token) : null;
  const session = await getSession();
  const here = `/invitations/accept?token=${encodeURIComponent(token ?? "")}`;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        {!invitation ? (
          <>
            <h1 className="mb-4 text-xl font-semibold">Invitation unavailable</h1>
            <Alert>This invitation is invalid, has expired, or was already used. Ask for a new one.</Alert>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-xl font-semibold">Join {invitation.organizationName}</h1>
            <p className="mb-6 text-sm text-neutral-400">
              You were invited as <span className="text-neutral-100">{invitation.role}</span> for{" "}
              <span className="text-neutral-100">{invitation.email}</span>.
            </p>
            {session ? (
              session.user.email.toLowerCase() === invitation.email ? (
                <AcceptButton token={token!} />
              ) : (
                <Alert>
                  You are signed in as {session.user.email}. Sign in with {invitation.email} to accept this invitation.
                </Alert>
              )
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <Link href={`/register?email=${encodeURIComponent(invitation.email)}&next=${encodeURIComponent(here)}`} className="rounded-md bg-emerald-500 px-4 py-2 text-center font-medium text-neutral-950 hover:bg-emerald-400">
                  Create an account to accept
                </Link>
                <Link href={`/login?next=${encodeURIComponent(here)}`} className="rounded-md border border-neutral-700 px-4 py-2 text-center hover:bg-neutral-800">
                  I already have an account
                </Link>
              </div>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
