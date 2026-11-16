"use client";
import { Alert, Button, Card, Field, Input } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/fetch-json";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateOrganizationForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const org = await apiFetch<{ id: string }>("/api/v1/organizations", {
        method: "POST",
        json: { name: String(new FormData(event.currentTarget).get("name")) },
      });
      router.push(`/app/${org.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">Create an organization</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Monitors, incidents and status pages belong to an organization. You can invite your team afterwards.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Organization name" htmlFor="name">
          <Input id="name" name="name" placeholder="Acme Inc." minLength={2} maxLength={120} required autoFocus />
        </Field>
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create organization"}</Button>
      </form>
    </Card>
  );
}
