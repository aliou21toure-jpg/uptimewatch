import { safeRedirectPath } from "@/lib/session";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create an account — UptimeWatch" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  return <RegisterForm next={safeRedirectPath(next)} defaultEmail={email ?? ""} />;
}
