import "server-only";
import { getWebEnv } from "@uptimewatch/config";
import { DomainError, type Actor, type DomainErrorCode } from "@uptimewatch/domain";
import { ZodError } from "zod";
import { getAuth } from "./auth";

const STATUS: Record<DomainErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
};

export function apiError(code: DomainErrorCode | "INTERNAL_ERROR", message: string, details?: unknown) {
  const status = code === "INTERNAL_ERROR" ? 500 : STATUS[code];
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

interface Context<P> {
  req: Request;
  params: P;
  actor: Actor;
  user: SessionUser;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cookie sessions are SameSite=Lax, which already blocks cross-site POSTs; this adds an explicit
 * origin check on state-changing requests as defense in depth against CSRF.
 */
function isCrossSite(req: Request): boolean {
  if (!MUTATING.has(req.method)) return false;
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  return origin !== null && origin !== new URL(getWebEnv().APP_URL).origin;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Request body must be valid JSON");
  }
}

/**
 * Wraps an authenticated API route: resolves the session, rejects cross-site writes, and turns
 * domain and validation errors into the normalized `{ error: { code, message, details } }` shape.
 * Tenant checks happen in the domain services, which every handler goes through.
 */
export function authenticated<P extends Record<string, string> = Record<string, never>>(
  handler: (ctx: Context<P>) => Promise<Response>,
) {
  return async (req: Request, segment: { params: Promise<P> }): Promise<Response> => {
    try {
      if (isCrossSite(req)) return apiError("FORBIDDEN", "Cross-site request rejected");
      const session = await getAuth().api.getSession({ headers: req.headers });
      if (!session) return apiError("UNAUTHENTICATED", "Sign in to continue");
      const { user } = session;
      return await handler({
        req,
        params: await segment.params,
        actor: { userId: user.id },
        user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
      });
    } catch (error) {
      if (error instanceof DomainError) return apiError(error.code, error.message);
      if (error instanceof ZodError) {
        return apiError(
          "VALIDATION_ERROR",
          "Invalid request",
          error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      // Log the error class only: driver messages can echo query parameters (user data).
      console.error(`[api] ${req.method} ${new URL(req.url).pathname} failed:`, error instanceof Error ? error.name : "unknown");
      return apiError("INTERNAL_ERROR", "Something went wrong");
    }
  };
}
