"use client";
import { Alert, Button, Card, Field, Input } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegisterForm({ next, defaultEmail }: { next: string; defaultEmail: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")),
      email,
      password: String(form.get("password")),
      callbackURL: next,
    });
    setPending(false);
    if (error) {
      setError(error.message ?? "Could not create the account.");
      return;
    }
    router.push(`/check-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-neutral-400">Start monitoring your sites in minutes.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required maxLength={100} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" defaultValue={defaultEmail} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
        </Field>
        <p className="-mt-2 text-xs text-neutral-500">At least 10 characters.</p>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-neutral-400">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-neutral-100 hover:underline">Sign in</Link>
      </p>
    </Card>
  );
}
