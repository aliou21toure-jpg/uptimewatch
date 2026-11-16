import { Card } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { getNotificationPreferences } from "@uptimewatch/domain";
import { loadOrg } from "../../org-context";
import { PreferencesForm } from "./preferences-form";

export const metadata = { title: "Notifications — UptimeWatch" };

export default async function NotificationSettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { session, org } = await loadOrg(orgId);
  const prefs = await getNotificationPreferences(getDb(), { userId: session.user.id }, orgId);
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Email alerts for {org.name}, sent to <span className="text-neutral-200">{session.user.email}</span>. These settings are yours only.
      </p>
      <Card className="mt-8"><PreferencesForm orgId={orgId} initial={prefs} /></Card>
    </div>
  );
}
