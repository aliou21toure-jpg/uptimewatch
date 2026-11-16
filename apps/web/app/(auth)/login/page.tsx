import { safeRedirectPath } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — UptimeWatch" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  return <LoginForm next={safeRedirectPath(next)} passwordReset={reset === "1"} />;
}
