import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2 text-lg font-semibold">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden /> UptimeWatch
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
