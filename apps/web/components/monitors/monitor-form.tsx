"use client";
import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/fetch-json";
import { MONITOR_INTERVALS } from "@uptimewatch/domain/monitors/constants";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface MonitorFormValues {
  name: string;
  url: string;
  method: "GET" | "HEAD";
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  bodyContains: string | null;
  headerNames: string[];
}

const intervalLabel = (s: number) => (s < 60 ? `${s} seconds` : s < 3600 ? `${s / 60} minute${s === 60 ? "" : "s"}` : "1 hour");

export function MonitorForm({ orgId, monitorId, initial }: { orgId: string; monitorId?: string; initial?: MonitorFormValues }) {
  const router = useRouter();
  const editing = Boolean(monitorId);
  const [method, setMethod] = useState<"GET" | "HEAD">(initial?.method ?? "GET");
  // When editing, header values are write-only: keep the stored ones unless the user replaces them.
  const [replaceHeaders, setReplaceHeaders] = useState(!editing);
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const keyword = String(f.get("bodyContains") ?? "").trim();
    const body = {
      name: String(f.get("name")),
      url: String(f.get("url")),
      method,
      intervalSeconds: Number(f.get("intervalSeconds")),
      timeoutMs: Math.round(Number(f.get("timeoutSeconds")) * 1000),
      expectedStatusMin: Number(f.get("expectedStatusMin")),
      expectedStatusMax: Number(f.get("expectedStatusMax")),
      bodyContains: method === "GET" && keyword ? keyword : null,
      ...(replaceHeaders ? { headers: headers.filter((h) => h.name.trim()) } : {}),
    };
    setPending(true);
    setError(null);
    try {
      const saved = await apiFetch<{ id: string }>(
        editing ? `/api/v1/organizations/${orgId}/monitors/${monitorId}` : `/api/v1/organizations/${orgId}/monitors`,
        { method: editing ? "PATCH" : "POST", json: body },
      );
      router.push(`/app/${orgId}/monitors/${saved.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error && <Alert>{error}</Alert>}
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" defaultValue={initial?.name} placeholder="Marketing website" maxLength={120} required />
        </Field>
        <Field label="URL" htmlFor="url">
          <Input id="url" name="url" type="url" defaultValue={initial?.url} placeholder="https://example.com/health" maxLength={2048} required />
        </Field>
        <Field label="Method" htmlFor="method">
          <Select id="method" value={method} onChange={(e) => setMethod(e.target.value as "GET" | "HEAD")}>
            <option value="GET">GET</option>
            <option value="HEAD">HEAD</option>
          </Select>
        </Field>
        <Field label="Check every" htmlFor="intervalSeconds">
          <Select id="intervalSeconds" name="intervalSeconds" defaultValue={initial?.intervalSeconds ?? 60}>
            {MONITOR_INTERVALS.map((s) => (
              <option key={s} value={s}>{intervalLabel(s)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Timeout (seconds)" htmlFor="timeoutSeconds">
          <Input id="timeoutSeconds" name="timeoutSeconds" type="number" min={1} max={30} step={1} defaultValue={(initial?.timeoutMs ?? 10000) / 1000} required />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-300">Accepted status codes</span>
          <div className="flex items-center gap-2">
            <Input aria-label="Minimum status code" name="expectedStatusMin" type="number" min={100} max={599} defaultValue={initial?.expectedStatusMin ?? 200} required />
            <span className="text-neutral-500">to</span>
            <Input aria-label="Maximum status code" name="expectedStatusMax" type="number" min={100} max={599} defaultValue={initial?.expectedStatusMax ?? 299} required />
          </div>
        </div>
        <div className="sm:col-span-2">
          <Field label="Response must contain (optional)" htmlFor="bodyContains">
            <Input
              id="bodyContains"
              name="bodyContains"
              defaultValue={initial?.bodyContains ?? ""}
              maxLength={200}
              disabled={method === "HEAD"}
              placeholder={method === "HEAD" ? "Not available with HEAD (no response body)" : "e.g. \"status\":\"ok\""}
            />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium text-neutral-300">Custom headers</h2>
          <p className="text-xs text-neutral-500">Encrypted at rest. Values are never shown again after saving.</p>
        </div>
        {editing && !replaceHeaders ? (
          <div className="flex items-center justify-between rounded-md border border-neutral-800 px-3 py-2 text-sm">
            <span className="text-neutral-400">
              {initial?.headerNames.length ? initial.headerNames.join(", ") : "No custom headers"}
            </span>
            <Button type="button" variant="secondary" onClick={() => setReplaceHeaders(true)}>Replace</Button>
          </div>
        ) : (
          <>
            {headers.map((h, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label="Header name" placeholder="Authorization" value={h.name} onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Input aria-label="Header value" placeholder="Bearer …" type="password" autoComplete="off" value={h.value} onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button type="button" variant="ghost" aria-label="Remove header" onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="secondary" onClick={() => setHeaders([...headers, { name: "", value: "" }])} disabled={headers.length >= 20}>
                Add header
              </Button>
            </div>
          </>
        )}
      </section>

      <div className="flex gap-3 border-t border-neutral-800 pt-6">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : editing ? "Save changes" : "Create monitor"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
