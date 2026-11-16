import { Alert, Card } from "@/components/ui/primitives";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-form";

export const metadata = { title: "Choose a new password — UptimeWatch" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  if (!token || error) {
    return (
      <Card>
        <h1 className="mb-4 text-xl font-semibold">Link expired</h1>
        <Alert>This reset link is invalid or has expired.</Alert>
        <p className="mt-6 text-sm text-neutral-400">
          <Link href="/forgot-password" className="hover:text-neutral-100">Request a new link</Link>
        </p>
      </Card>
    );
  }
  return <ResetPasswordForm token={token} />;
}
