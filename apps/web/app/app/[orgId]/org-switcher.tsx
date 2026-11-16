"use client";
import { Select } from "@/components/ui/primitives";
import { useRouter } from "next/navigation";

export function OrgSwitcher({ current, orgs, compact = false }: { current: string; orgs: { id: string; name: string }[]; compact?: boolean }) {
  const router = useRouter();
  const id = compact ? "org-switcher-mobile" : "org-switcher";
  return (
    <div className={`flex flex-col gap-1 ${compact ? "" : "px-2"}`}>
      <label htmlFor={id} className={compact ? "sr-only" : "text-xs uppercase tracking-wide text-neutral-500"}>Organization</label>
      <Select
        id={id}
        className="w-full"
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
