import { pingDatabase } from "@uptimewatch/db";
import { createRedis, pingRedis } from "@uptimewatch/queue";

export const dynamic = "force-dynamic";

type CheckResult = "ok" | "error";

async function check(fn: () => Promise<void>): Promise<CheckResult> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    // Log the failure server-side; the response only exposes ok/error, never connection details.
    console.error("[health/ready] dependency check failed:", error instanceof Error ? error.name : "unknown");
    return "error";
  }
}

/** Readiness: essential dependencies (PostgreSQL, Redis) are reachable. */
export async function GET() {
  const redis = createRedis();
  try {
    const [postgres, redisStatus] = await Promise.all([
      check(pingDatabase),
      check(() => pingRedis(redis)),
    ]);
    const ready = postgres === "ok" && redisStatus === "ok";
    return Response.json(
      { status: ready ? "ok" : "unavailable", checks: { postgres, redis: redisStatus } },
      { status: ready ? 200 : 503 },
    );
  } finally {
    redis.disconnect();
  }
}
