"use client";
import { Alert, Button, Card, Field, Input } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    await authClient.requestPasswordReset({
      email: String(new FormData(event.currentTarget).get("email")),
      redirectTo: "/reset-password",
    });
    // Same answer whether or not the account exists, so emails cannot be enumerated.
    setPending(false);
    setSent(true);
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">Reset your password</h1>
      <p className="mb-6 text-sm text-neutral-400">We will email you a link to choose a new one.</p>
      {sent ? (
        <Alert tone="success">If an account exists for that address, a reset link has been sent.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
        </form>
      )}
      <p className="mt-6 text-sm text-neutral-400">
        <Link href="/login" className="hover:text-neutral-100">Back to sign in</Link>
      </p>
    </Card>
  );
}
