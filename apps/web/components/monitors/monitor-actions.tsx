"use client";
import { Button } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/fetch-json";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MonitorActions({ orgId, monitorId, enabled, name }: { orgId: string; monitorId: string; enabled: boolean; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/v1/organizations/${orgId}/monitors/${monitorId}`;

  async function run(fn: () => Promise<unknown>, then: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      then();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <Link href={`/app/${orgId}/monitors/${monitorId}/edit`} className="inline-flex h-9 items-center rounded-md border border-neutral-700 px-4 text-sm hover:bg-neutral-800">
          Edit
        </Link>
        <Button variant="secondary" disabled={busy} onClick={() => run(() => apiFetch(`${base}/${enabled ? "pause" : "resume"}`, { method: "POST" }), () => router.refresh())}>
          {enabled ? "Pause" : "Resume"}
        </Button>
        {confirmDelete ? (
          <>
            <Button variant="danger" disabled={busy} onClick={() => run(() => apiFetch(base, { method: "DELETE" }), () => { router.push(`/app/${orgId}/monitors`); router.refresh(); })}>
              Delete “{name}”
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
