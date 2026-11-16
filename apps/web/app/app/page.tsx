import { requireSession } from "@/lib/session";
import { getDb } from "@uptimewatch/db";
import { listOrganizationsForUser } from "@uptimewatch/domain";
import { redirect } from "next/navigation";

/** Entry point after sign-in: go to the first organization, or create one. */
export default async function AppIndex() {
  const { user } = await requireSession();
  const orgs = await listOrganizationsForUser(getDb(), { userId: user.id });
  redirect(orgs[0] ? `/app/${orgs[0].id}` : "/app/onboarding");
}
