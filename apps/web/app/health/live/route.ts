export const dynamic = "force-dynamic";

/** Liveness: the process is up and able to answer. Checks no dependencies. */
export function GET() {
  return Response.json({ status: "ok" });
}
