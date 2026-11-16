"use client";
import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/fetch-json";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Component = { monitorId: string; displayName: string; monitorName: string };

export function ComponentsEditor({
  orgId,
  pageId,
  canWrite,
  initial,
  monitors,
}: {
  orgId: string;
  pageId: string;
  canWrite: boolean;
  initial: Component[];
  monitors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const available = monitors.filter((m) => !items.some((i) => i.monitorId === m.id));

  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    setItems(next);
  };

  async function save() {
    setPending(true);
    setStatus(null);
    try {
      await apiFetch(`/api/v1/organizations/${orgId}/status-pages/${pageId}/components`, {
        method: "PUT",
        json: items.map((i) => ({ monitorId: i.monitorId, displayName: i.displayName.trim() || null })),
      });
      setStatus({ tone: "success", text: "Saved. The public page is updated." });
      router.refresh();
    } catch (e) {
      setStatus({ tone: "error", text: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
      {items.length === 0 && <p className="text-sm text-neutral-500">No components yet.</p>}
      <ol className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={item.monitorId} className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-800 px-3 py-2">
            <span className="w-6 text-sm tabular-nums text-neutral-500">{i + 1}.</span>
            <div className="min-w-40 flex-1">
              <p className="text-xs text-neutral-500">Monitor: {item.monitorName}</p>
              <label className="sr-only" htmlFor={`name-${item.monitorId}`}>Public name for {item.monitorName}</label>
              <Input
                id={`name-${item.monitorId}`}
                value={item.displayName}
                placeholder={item.monitorName}
                maxLength={120}
                disabled={!canWrite}
                onChange={(e) => setItems(items.map((x) => (x.monitorId === item.monitorId ? { ...x, displayName: e.target.value } : x)))}
              />
            </div>
            {canWrite && (
              <div className="flex gap-1">
                <Button type="button" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                <Button type="button" variant="ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</Button>
                <Button type="button" variant="danger" onClick={() => setItems(items.filter((x) => x.monitorId !== item.monitorId))}>Remove</Button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {canWrite && (
        <div className="flex flex-wrap gap-2 border-t border-neutral-800 pt-4">
          <label className="sr-only" htmlFor="add-component">Add a monitor</label>
          <Select
            id="add-component"
            value=""
            disabled={available.length === 0}
            onChange={(e) => {
              const m = monitors.find((x) => x.id === e.target.value);
              if (m) setItems([...items, { monitorId: m.id, displayName: "", monitorName: m.name }]);
            }}
          >
            <option value="">{available.length ? "Add a monitor…" : "All monitors added"}</option>
            {available.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <Button type="button" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save components"}</Button>
        </div>
      )}
    </div>
  );
}

export function PageSettingsForm({
  orgId,
  pageId,
  initial,
}: {
  orgId: string;
  pageId: string;
  initial: { title: string; slug: string; description: string; isPublic: boolean };
}) {
  const router = useRouter();
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setPending(true);
    setStatus(null);
    try {
      await apiFetch(`/api/v1/organizations/${orgId}/status-pages/${pageId}`, {
        method: "PATCH",
        json: {
          title: f.get("title"),
          slug: f.get("slug"),
          description: String(f.get("description") ?? "").trim() || null,
          isPublic: f.get("isPublic") === "on",
        },
      });
      setStatus({ tone: "success", text: "Saved." });
      router.refresh();
    } catch (e) {
      setStatus({ tone: "error", text: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="title"><Input id="title" name="title" defaultValue={initial.title} required maxLength={160} /></Field>
        <Field label="URL slug" htmlFor="slug"><Input id="slug" name="slug" defaultValue={initial.slug} required minLength={3} maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" /></Field>
      </div>
      <Field label="Description (optional)" htmlFor="description">
        <textarea
          id="description"
          name="description"
          defaultValue={initial.description}
          maxLength={1000}
          rows={3}
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPublic" defaultChecked={initial.isPublic} className="h-4 w-4 accent-emerald-500" />
        Public — anyone with the link can see this page
      </label>
      <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button></div>
    </form>
  );
}

export function DeletePageButton({ orgId, pageId, title }: { orgId: string; pageId: string; title: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <div className="flex gap-2">
      <Button
        variant="danger"
        onClick={async () => {
          await apiFetch(`/api/v1/organizations/${orgId}/status-pages/${pageId}`, { method: "DELETE" });
          router.push(`/app/${orgId}/status-pages`);
          router.refresh();
        }}
      >
        Delete “{title}”
      </Button>
      <Button variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
    </div>
  ) : (
    <Button variant="danger" onClick={() => setConfirm(true)}>Delete page</Button>
  );
}
