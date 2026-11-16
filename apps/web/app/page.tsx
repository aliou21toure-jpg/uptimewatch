import { getSession } from "@/lib/session";
import Link from "next/link";

export default async function HomePage() {
  const session = await getSession().catch(() => null);
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <p className="font-mono text-sm text-emerald-400">● in development</p>
      <h1 className="text-4xl font-semibold tracking-tight">UptimeWatch</h1>
      <p className="text-neutral-400">
        Uptime monitoring for websites and APIs: scheduled checks, confirmed incidents, email alerts and public status
        pages, for your whole team.
      </p>
      <div className="flex gap-3">
        {session ? (
          <Link href="/app" className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400">Open dashboard</Link>
        ) : (
          <>
            <Link href="/register" className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400">Get started</Link>
            <Link href="/login" className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800">Sign in</Link>
          </>
        )}
      </div>
    </main>
  );
}
