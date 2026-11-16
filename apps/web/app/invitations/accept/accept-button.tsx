"use client";
import { Alert, Button } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/fetch-json";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {error && <Alert>{error}</Alert>}
      <Button
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const { orgId } = await apiFetch<{ orgId: string }>("/api/v1/invitations/accept", { method: "POST", json: { token } });
            router.push(`/app/${orgId}`);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
            setPending(false);
          }
        }}
      >
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </div>
  );
}
