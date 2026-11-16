"use client";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/fetch-json";
import { useRouter } from "next/navigation";
import { useState } from "react";

const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);

export function CreateStatusPageForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const page = await apiFetch<{ id: string }>(`/api/v1/organizations/${orgId}/status-pages`, { method: "POST", json: { title, slug } });
      router.push(`/app/${orgId}/status-pages/${page.id}`);
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="sp-title">
          <Input
            id="sp-title"
            value={title}
            required
            maxLength={160}
            placeholder="Acme Status"
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Public URL" htmlFor="sp-slug">
          <div className="flex items-center rounded-md border border-neutral-700 bg-neutral-900 pl-3 text-sm focus-within:border-emerald-500">
            <span className="text-neutral-500">/status/</span>
            <input
              id="sp-slug"
              value={slug}
              required
              minLength={3}
              maxLength={100}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              className="h-9 min-w-0 flex-1 bg-transparent px-1 text-neutral-100 focus:outline-none"
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          </div>
        </Field>
      </div>
      <div><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create status page"}</Button></div>
    </form>
  );
}
