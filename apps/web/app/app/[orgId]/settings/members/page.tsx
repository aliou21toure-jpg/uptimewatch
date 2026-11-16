import { Card } from "@/components/ui/primitives";
import { getDb } from "@uptimewatch/db";
import { can, listMembers, listPendingInvitations } from "@uptimewatch/domain";
import { loadOrg } from "../../org-context";
import { InviteForm, MemberRow, PendingInvitation } from "./members-client";

export const metadata = { title: "Members — UptimeWatch" };

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { session, org } = await loadOrg(orgId);
  const actor = { userId: session.user.id };
  const canManage = can(org.role, "member:invite");
  const [members, invitations] = await Promise.all([
    listMembers(getDb(), actor, orgId),
    canManage ? listPendingInvitations(getDb(), actor, orgId) : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Members</h1>
      <p className="mt-1 text-sm text-neutral-400">People with access to {org.name}.</p>

      {canManage && (
        <Card className="mt-8">
          <h2 className="mb-4 font-medium">Invite someone</h2>
          <InviteForm orgId={orgId} />
        </Card>
      )}

      <Card className="mt-6 p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-800 text-neutral-400">
            <tr>
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Role</th>
              <th className="px-6 py-3 font-medium sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow
                key={m.userId}
                orgId={orgId}
                member={{ userId: m.userId, name: m.name, email: m.email, role: m.role }}
                isSelf={m.userId === session.user.id}
                actorRole={org.role}
              />
            ))}
          </tbody>
        </table>
      </Card>

      {canManage && invitations.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-4 font-medium">Pending invitations</h2>
          <ul className="flex flex-col divide-y divide-neutral-800">
            {invitations.map((i) => (
              <PendingInvitation key={i.id} orgId={orgId} invitation={{ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
