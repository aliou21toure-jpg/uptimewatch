import { getDb } from "@uptimewatch/db";
import { listOrganizationsForUser } from "@uptimewatch/domain";
import Link from "next/link";
import type { ReactNode } from "react";
import { loadOrg } from "./org-context";
import { OrgSwitcher } from "./org-switcher";
import { SignOutButton } from "./sign-out-button";

export default async function OrgLayout({ children, params }: { children: ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { session, org } = await loadOrg(orgId);
  const orgs = await listOrganizationsForUser(getDb(), { userId: session.user.id });

  const nav = [
    { href: `/app/${orgId}`, label: "Overview" },
    { href: `/app/${orgId}/monitors`, label: "Monitors" },
    { href: `/app/${orgId}/incidents`, label: "Incidents" },
    { href: `/app/${orgId}/status-pages`, label: "Status pages" },
    { href: `/app/${orgId}/settings/members`, label: "Members" },
    { href: `/app/${orgId}/settings/notifications`, label: "Notifications" },
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link href="/app" className="flex items-center gap-2 font-semibold">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden /> UptimeWatch
          </Link>
          <div className="w-44"><OrgSwitcher current={org.id} orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} compact /></div>
        </div>
        <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto text-sm" aria-label="Sections">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="shrink-0 rounded-md px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 px-3 py-4 md:flex">
        <Link href="/app" className="mb-6 flex items-center gap-2 px-2 font-semibold">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden /> UptimeWatch
        </Link>
        <OrgSwitcher current={org.id} orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} />
        <nav className="mt-6 flex flex-col gap-1">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-md px-2 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-neutral-800 pt-4">
          <p className="truncate px-2 text-sm text-neutral-200">{session.user.name}</p>
          <p className="mb-2 truncate px-2 text-xs text-neutral-500">{session.user.email}</p>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
