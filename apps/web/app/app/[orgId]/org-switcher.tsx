"use client";
import { Select } from "@/components/ui/primitives";
import { useRouter } from "next/navigation";

export function OrgSwitcher({ current, orgs }: { current: string; orgs: { id: string; name: string }[] }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-1 px-2">
      <label htmlFor="org-switcher" className="text-xs uppercase tracking-wide text-neutral-500">Organization</label>
      <Select
        id="org-switcher"
        value={current}
        onChange={(e) => router.push(e.target.value === "__new" ? "/app/onboarding" : `/app/${e.target.value}`)}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
        <option value="__new">+ New organization</option>
      </Select>
    </div>
  );
}
