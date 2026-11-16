import { AutoRefresh } from "@/components/auto-refresh";
import { formatInterval, formatRelative, STATE_OPTIONS, StateBadge } from "@/components/monitors/state-badge";
import { Card, Input, Select } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { can, DomainError, listMonitors } from "@uptimewatch/domain";
import Link from "next/link";
import { loadOrg } from "../org-context";

export const metadata = { title: "Monitors — UptimeWatch" };

type Search = { q?: string; state?: string; cursor?: string };

export default async function MonitorsPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<Search> }) {
  const { orgId } = await params;
  const search = await searchParams;
  const { session, org } = await loadOrg(orgId);
  const canWrite = can(org.role, "monitor:write");

  let result: Awaited<ReturnType<typeof listMonitors>>;
  try {
    result = await listMonitors(getDb(), { userId: session.user.id }, orgId, {
      ...(search.q ? { q: search.q } : {}),
      ...(search.state ? { state: search.state } : {}),
      ...(search.cursor ? { cursor: search.cursor } : {}),
    });
  } catch (error) {
    // A stale or hand-edited query string should not break the page.
    if (!(error instanceof DomainError) && (error as Error)?.name !== "ZodError") throw error;
    result = await listMonitors(getDb(), { userId: session.user.id }, orgId, {});
  }
  const filtered = Boolean(search.q || search.state);
  const nextHref = result.nextCursor
    ? `?${new URLSearchParams({ ...(search.q ? { q: search.q } : {}), ...(search.state ? { state: search.state } : {}), cursor: result.nextCursor })}`
    : null;

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Monitors</h1>
          <p className="mt-1 text-sm text-neutral-400">Websites and APIs checked on a schedule.</p>
        </div>
        {canWrite && (
          <Link href={`/app/${orgId}/monitors/new`} className="inline-flex h-9 items-center rounded-md bg-emerald-500 px-4 text-sm font-medium text-neutral-950 hover:bg-emerald-400">
            New monitor
          </Link>
        )}
      </div>

      <form className="mt-6 flex flex-col gap-3 sm:flex-row" action="">
        <label className="sr-only" htmlFor="q">Search</label>
        <Input id="q" name="q" defaultValue={search.q ?? ""} placeholder="Search by name or URL" className="sm:max-w-xs" />
        <label className="sr-only" htmlFor="state">State</label>
        <Select id="state" name="state" defaultValue={search.state ?? ""} className="sm:w-40">
          <option value="">All states</option>
          {STATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <button className="h-9 rounded-md border border-neutral-700 px-4 text-sm hover:bg-neutral-800">Filter</button>
        {filtered && <Link href={`/app/${orgId}/monitors`} className="self-center text-sm text-neutral-400 hover:text-neutral-100">Clear</Link>}
      </form>

      <Card className="mt-4 overflow-x-auto p-0">
        {result.data.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-neutral-300">{filtered ? "No monitor matches these filters." : "No monitors yet."}</p>
            {!filtered && canWrite && (
              <p className="mt-1 text-sm text-neutral-500">
                <Link href={`/app/${orgId}/monitors/new`} className="text-emerald-400 hover:underline">Add your first website or API</Link> to start checking it every minute.
              </p>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-800 text-neutral-400">
              <tr>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Monitor</th>
                <th className="px-6 py-3 font-medium">Interval</th>
                <th className="px-6 py-3 font-medium">Last check</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((m) => (
                <tr key={m.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900">
                  <td className="px-6 py-3"><StateBadge state={m.state} /></td>
                  <td className="max-w-md px-6 py-3">
                    <Link href={`/app/${orgId}/monitors/${m.id}`} className="font-medium text-neutral-100 hover:underline">{m.name}</Link>
                    <p className="truncate text-xs text-neutral-500"><span className="font-mono">{m.method}</span> {m.url}</p>
                  </td>
                  <td className="px-6 py-3 text-neutral-300">{formatInterval(m.intervalSeconds)}</td>
                  <td className="px-6 py-3 text-neutral-400">{formatRelative(m.lastCheckedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {(search.cursor || nextHref) && (
        <div className="mt-4 flex justify-end gap-4 text-sm">
          {search.cursor && <Link href={`/app/${orgId}/monitors`} className="text-neutral-400 hover:text-neutral-100">First page</Link>}
          {nextHref && <Link href={nextHref} className="text-neutral-200 hover:underline">Next page →</Link>}
        </div>
      )}
      <AutoRefresh seconds={20} />
    </div>
  );
}
