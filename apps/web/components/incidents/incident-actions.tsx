"use client";
import { Alert, Button, Select } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/fetch-json";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcknowledgeButton({ orgId, incidentId }: { orgId: string; incidentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await apiFetch(`/api/v1/organizations/${orgId}/incidents/${incidentId}/acknowledge`, { method: "POST" }).catch(() => {});
        router.refresh();
        setBusy(false);
      }}
    >
      Acknowledge
    </Button>
  );
}

export function UpdateForm({ orgId, incidentId }: { orgId: string; incidentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/organizations/${orgId}/incidents/${incidentId}/updates`, {
        method: "POST",
        json: { status: data.get("status"), message: data.get("message") },
      });
      form.reset();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {error && <Alert>{error}</Alert>}
      <label className="sr-only" htmlFor="update-message">Update</label>
      <textarea
        id="update-message"
        name="message"
        required
        maxLength={5000}
        rows={3}
        placeholder="What do you know so far?"
        className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none"
      />
      <div className="flex gap-3">
        <label className="sr-only" htmlFor="update-status">Status</label>
        <Select id="update-status" name="status" defaultValue="investigating">
          <option value="investigating">Investigating</option>
          <option value="identified">Identified</option>
          <option value="monitoring">Monitoring a fix</option>
        </Select>
        <Button type="submit" disabled={pending}>{pending ? "Posting…" : "Post update"}</Button>
      </div>
      <p className="text-xs text-neutral-500">
        The incident resolves on its own after two successful checks in a row. Updates are also published on any public
        status page that shows this monitor.
      </p>
    </form>
  );
}
