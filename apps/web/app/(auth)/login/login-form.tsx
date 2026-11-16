"use client";
import { Alert, Button, Card, Field, Input } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({ next, passwordReset }: { next: string; passwordReset: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
      callbackURL: next,
    });
    setPending(false);
    if (error) {
      if (error.status === 403) {
        router.push(`/check-email?email=${encodeURIComponent(String(form.get("email")))}`);
        return;
      }
      setError(error.status === 429 ? "Too many attempts. Wait a minute and try again." : "Invalid email or password.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-neutral-400">Welcome back.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {passwordReset && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="mt-6 flex justify-between text-sm text-neutral-400">
        <Link href="/forgot-password" className="hover:text-neutral-100">Forgot password?</Link>
        <Link href={`/register?next=${encodeURIComponent(next)}`} className="hover:text-neutral-100">Create an account</Link>
      </div>
    </Card>
  );
}
