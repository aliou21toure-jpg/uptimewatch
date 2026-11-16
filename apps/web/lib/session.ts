import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";

export async function getSession() {
  // Reading headers first marks the page as dynamic, so nothing touches runtime config at build time.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}

/** For server components under /app: redirects to the login page when signed out. */
export async function requireSession(returnTo = "/app") {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return session;
}

/** Only same-site relative paths are accepted as post-login destinations (no open redirect). */
export function safeRedirectPath(value: string | null | undefined, fallback = "/app"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
