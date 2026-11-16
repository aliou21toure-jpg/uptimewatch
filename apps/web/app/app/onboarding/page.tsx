import { requireSession } from "@/lib/session";
import { CreateOrganizationForm } from "./create-org-form";

export const metadata = { title: "Create an organization — UptimeWatch" };

export default async function OnboardingPage() {
  const { user } = await requireSession("/app/onboarding");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <p className="mb-2 text-sm text-neutral-400">Hi {user.name},</p>
        <CreateOrganizationForm />
      </div>
    </main>
  );
}
