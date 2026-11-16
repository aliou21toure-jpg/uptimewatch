import { authenticated, readJson } from "@/lib/api";
import { getDb } from "@uptimewatch/db";
import { createOrganization, listOrganizationsForUser } from "@uptimewatch/domain";

export const dynamic = "force-dynamic";

export const GET = authenticated(async ({ actor }) =>
  Response.json({ data: await listOrganizationsForUser(getDb(), actor) }),
);

export const POST = authenticated(async ({ req, actor }) => {
  const org = await createOrganization(getDb(), actor, await readJson(req));
  return Response.json({ data: org }, { status: 201 });
});
