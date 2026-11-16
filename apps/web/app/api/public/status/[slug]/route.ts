import { getDb } from "@uptimewatch/db";
import { getPublicStatusPage } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

const HEADERS = {
  // Public data: cacheable by CDNs and usable from any website (badges, widgets).
  "cache-control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
  "access-control-allow-origin": "*",
};

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const page = await getPublicStatusPage(getDb(), (await params).slug);
  if (!page) {
    return Response.json({ error: { code: "NOT_FOUND", message: "Status page not found" } }, { status: 404, headers: { "cache-control": "public, max-age=30" } });
  }
  return Response.json({ data: page }, { headers: HEADERS });
}
