"use client";
import { Alert, Button, Card, Field, Input } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const { error } = await authClient.resetPassword({
      newPassword: String(new FormData(event.currentTarget).get("password")),
      token,
    });
    setPending(false);
    if (error) return setError(error.message ?? "Could not reset the password.");
    router.push("/login?reset=1");
  }

  return (
    <Card>
      <h1 className="mb-6 text-xl font-semibold">Choose a new password</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="New password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
        </Field>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save password"}</Button>
      </form>
    </Card>
  );
}
