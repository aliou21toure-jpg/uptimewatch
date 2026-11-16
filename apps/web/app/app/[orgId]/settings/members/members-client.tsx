"use client";
import { Alert, Button, Input, Select } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/fetch-json";
import { canAssignRole, type MemberRole } from "@uptimewatch/domain/permissions";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InviteForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setPending(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ email: string; emailSent: boolean }>(`/api/v1/organizations/${orgId}/invitations`, {
        method: "POST",
        json: { email: form.get("email"), role: form.get("role") },
      });
      setMessage(
        result.emailSent
          ? { tone: "success", text: `Invitation sent to ${result.email}.` }
          : { tone: "error", text: `Invitation created, but the email could not be delivered. Try again later.` },
      );
      formEl.reset();
      router.refresh();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="invite-email">Email</label>
        <Input id="invite-email" name="email" type="email" placeholder="teammate@company.com" required />
        <label className="sr-only" htmlFor="invite-role">Role</label>
        <Select id="invite-role" name="role" defaultValue="member" className="sm:w-36">
          <option value="admin">Admin</option>
          <option value="member">Member</option>
          <option value="viewer">Viewer</option>
        </Select>
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invite"}</Button>
      </div>
    </form>
  );
}

const ROLE_OPTIONS: MemberRole[] = ["owner", "admin", "member", "viewer"];

export function MemberRow({
  orgId,
  member,
  isSelf,
  actorRole,
}: {
  orgId: string;
  member: { userId: string; name: string; email: string; role: MemberRole };
  isSelf: boolean;
  actorRole: MemberRole;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = canAssignRole(actorRole, member.role, "viewer") || canAssignRole(actorRole, member.role, member.role);
  const removable = isSelf || canAssignRole(actorRole, member.role, null);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-neutral-800 last:border-0">
      <td className="px-6 py-3">
        <p className="text-neutral-100">{member.name}{isSelf && <span className="text-neutral-500"> (you)</span>}</p>
        <p className="text-xs text-neutral-500">{member.email}</p>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </td>
      <td className="px-6 py-3">
        {editable ? (
          <Select
            aria-label={`Role of ${member.name}`}
            value={member.role}
            disabled={busy}
            onChange={(e) =>
              run(() => apiFetch(`/api/v1/organizations/${orgId}/members/${member.userId}`, { method: "PATCH", json: { role: e.target.value } }))
            }
          >
            {ROLE_OPTIONS.filter((r) => r === member.role || canAssignRole(actorRole, member.role, r)).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        ) : (
          <span className="capitalize text-neutral-300">{member.role}</span>
        )}
      </td>
      <td className="px-6 py-3 text-right">
        {removable && (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              run(
                () => apiFetch(`/api/v1/organizations/${orgId}/members/${member.userId}`, { method: "DELETE" }),
                isSelf ? () => router.push("/app") : undefined,
              )
            }
          >
            {isSelf ? "Leave" : "Remove"}
          </Button>
        )}
      </td>
    </tr>
  );
}

export function PendingInvitation({
  orgId,
  invitation,
}: {
  orgId: string;
  invitation: { id: string; email: string; role: string; expiresAt: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex items-center justify-between py-3 text-sm">
      <div>
        <p className="text-neutral-100">{invitation.email}</p>
        <p className="text-xs text-neutral-500">
          {invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}
        </p>
      </div>
      <Button
        variant="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await apiFetch(`/api/v1/organizations/${orgId}/invitations/${invitation.id}`, { method: "DELETE" }).catch(() => {});
          router.refresh();
        }}
      >
        Revoke
      </Button>
    </li>
  );
}
