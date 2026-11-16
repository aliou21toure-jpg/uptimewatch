import { authenticated, readJson } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { acceptInvitation } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const POST = authenticated(async ({ req, user }) => {
  const result = await acceptInvitation(
    getDb(),
    { userId: user.id, email: user.email, emailVerified: user.emailVerified },
    (await readJson(req)),
  );
  return Response.json({ data: result });
});
