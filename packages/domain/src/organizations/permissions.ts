import type { MemberRole } from "@uptimewatch/db/schema";

export type { MemberRole };

export const ROLES = ["owner", "admin", "member", "viewer"] as const satisfies readonly MemberRole[];

/** Every action a member can attempt. Later phases reuse the monitor/incident/status-page actions. */
export type Action =
  | "organization:read"
  | "organization:update"
  | "member:read"
  | "member:invite"
  | "member:update-role"
  | "member:remove"
  | "monitor:read"
  | "monitor:write"
  | "incident:read"
  | "incident:write"
  | "status-page:read"
  | "status-page:write";

const READ: Action[] = [
  "organization:read",
  "member:read",
  "monitor:read",
  "incident:read",
  "status-page:read",
];
const OPERATE: Action[] = ["monitor:write", "incident:write"];
const MANAGE: Action[] = [
  "organization:update",
  "member:invite",
  "member:update-role",
  "member:remove",
  "status-page:write",
];

const MATRIX: Record<MemberRole, ReadonlySet<Action>> = {
  owner: new Set([...READ, ...OPERATE, ...MANAGE]),
  admin: new Set([...READ, ...OPERATE, ...MANAGE]),
  member: new Set([...READ, ...OPERATE]),
  viewer: new Set(READ),
};

export function can(role: MemberRole, action: Action): boolean {
  return MATRIX[role].has(action);
}

/**
 * Whether `actor` may give `target` the role `newRole` (or remove them when `newRole` is null).
 * Only owners may create, change or remove owners; nobody else can touch an owner.
 */
export function canAssignRole(
  actor: MemberRole,
  targetCurrent: MemberRole | null,
  newRole: MemberRole | null,
): boolean {
  if (!can(actor, "member:update-role")) return false;
  if (actor === "owner") return true;
  return targetCurrent !== "owner" && newRole !== "owner";
}
