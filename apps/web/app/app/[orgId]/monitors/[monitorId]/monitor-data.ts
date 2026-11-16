import "server-only";
import { getDb } from "@uptimewatch/db";
import { DomainError, getMonitor } from "@uptimewatch/domain";
import { notFound } from "next/navigation";
import { cache } from "react";
import { loadOrg } from "../../org-context";

export const loadMonitor = cache(async (orgId: string, monitorId: string) => {
  const { session, org } = await loadOrg(orgId);
  try {
    const monitor = await getMonitor(getDb(), { userId: session.user.id }, orgId, monitorId);
    return { org, monitor };
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});
