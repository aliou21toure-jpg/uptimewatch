import "server-only";
import { requireSession } from "@/lib/session";
import { getDb } from "@uptimewatch/db";
import { DomainError, getOrganization } from "@uptimewatch/domain";
import { notFound } from "next/navigation";
import { cache } from "react";

/** Loads the current user's view of an organization once per request (layout + page share it). */
export const loadOrg = cache(async (orgId: string) => {
  const session = await requireSession(`/app/${orgId}`);
  try {
    const org = await getOrganization(getDb(), { userId: session.user.id }, orgId);
    return { session, org };
  } catch (error) {
    // Non-members get the same 404 as a missing organization.
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});
