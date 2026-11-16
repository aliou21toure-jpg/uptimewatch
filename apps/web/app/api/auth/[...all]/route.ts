import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => getAuth().handler(req);
export const POST = (req: Request) => getAuth().handler(req);
