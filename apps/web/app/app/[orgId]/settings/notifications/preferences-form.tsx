"use client";
import { apiFetch } from "@/lib/fetch-json";
import { useState } from "react";

type Prefs = { enabled: boolean; incidentOpened: boolean; incidentResolved: boolean };

export function PreferencesForm({ orgId, initial }: { orgId: string; initial: Prefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function toggle(key: keyof Prefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setStatus("Saving…");
    try {
      await apiFetch(`/api/v1/organizations/${orgId}/notification-preferences`, { method: "PATCH", json: { [key]: next[key] } });
      setStatus("Saved");
    } catch (e) {
      setPrefs(prefs);
      setStatus((e as Error).message);
    }
  }

  const rows: [keyof Prefs, string, string][] = [
    ["enabled", "Email alerts", "Turn all incident emails for this organization on or off."],
    ["incidentOpened", "When a monitor goes down", "Sent once an outage is confirmed (two failed checks in a row)."],
    ["incidentResolved", "When it recovers", "Sent after two successful checks in a row, with the outage duration."],
  ];

  return (
    <div className="flex flex-col divide-y divide-neutral-800">
      {rows.map(([key, title, help]) => {
        const disabled = key !== "enabled" && !prefs.enabled;
        return (
          <label key={key} className={`flex cursor-pointer items-start justify-between gap-6 py-4 first:pt-0 ${disabled ? "opacity-50" : ""}`}>
            <span>
              <span className="block text-sm font-medium text-neutral-100">{title}</span>
              <span className="block text-xs text-neutral-500">{help}</span>
            </span>
            <input type="checkbox" className="mt-1 h-4 w-4 accent-emerald-500" checked={prefs[key]} disabled={disabled} onChange={() => toggle(key)} />
          </label>
        );
      })}
      {status && <p className="pt-3 text-xs text-neutral-500" role="status">{status}</p>}
    </div>
  );
}
