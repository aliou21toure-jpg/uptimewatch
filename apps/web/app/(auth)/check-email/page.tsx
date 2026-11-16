import { Card } from "@/components/ui/primitives";
import Link from "next/link";
import { ResendVerification } from "./resend";

export const metadata = { title: "Check your email — UptimeWatch" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <Card>
      <h1 className="mb-2 text-xl font-semibold">Check your email</h1>
      <p className="text-sm text-neutral-400">
        We sent a verification link{email ? <> to <span className="text-neutral-100">{email}</span></> : null}. Open it to
        activate your account; you will be signed in automatically.
      </p>
      {email && <ResendVerification email={email} />}
      <p className="mt-6 text-sm text-neutral-400">
        <Link href="/login" className="hover:text-neutral-100">Back to sign in</Link>
      </p>
    </Card>
  );
}
