export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <p className="font-mono text-sm text-emerald-400">● phase 0 — foundations</p>
      <h1 className="text-4xl font-semibold tracking-tight">UptimeWatch</h1>
      <p className="text-neutral-400">
        Uptime monitoring for websites and APIs. The product is being built in phases; this page is
        a placeholder until the dashboard lands.
      </p>
      <p className="font-mono text-sm text-neutral-500">
        <a className="underline" href="/health/live">/health/live</a>
        {" · "}
        <a className="underline" href="/health/ready">/health/ready</a>
      </p>
    </main>
  );
}
