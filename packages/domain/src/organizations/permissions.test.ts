import { describe, expect, it } from "vitest";
import { can, canAssignRole, ROLES } from "./permissions";

describe("can", () => {
  it("lets viewers read but never write", () => {
    expect(can("viewer", "monitor:read")).toBe(true);
    expect(can("viewer", "monitor:write")).toBe(false);
    expect(can("viewer", "incident:write")).toBe(false);
    expect(can("viewer", "member:invite")).toBe(false);
  });

  it("lets members manage monitors but not people", () => {
    expect(can("member", "monitor:write")).toBe(true);
    expect(can("member", "member:invite")).toBe(false);
    expect(can("member", "member:update-role")).toBe(false);
  });

  it("gives admins and owners management rights", () => {
    for (const role of ["admin", "owner"] as const) {
      expect(can(role, "member:invite")).toBe(true);
      expect(can(role, "organization:update")).toBe(true);
    }
  });

  it("grants every role read access to the organization", () => {
    for (const role of ROLES) expect(can(role, "organization:read")).toBe(true);
  });
});

describe("canAssignRole", () => {
  it("lets owners do anything, including creating or removing owners", () => {
    expect(canAssignRole("owner", "member", "owner")).toBe(true);
    expect(canAssignRole("owner", "owner", "admin")).toBe(true);
    expect(canAssignRole("owner", "owner", null)).toBe(true);
  });

  it("stops admins from touching or creating owners", () => {
    expect(canAssignRole("admin", "member", "admin")).toBe(true);
    expect(canAssignRole("admin", "member", "owner")).toBe(false);
    expect(canAssignRole("admin", "owner", "viewer")).toBe(false);
    expect(canAssignRole("admin", "owner", null)).toBe(false);
  });

  it("refuses members and viewers entirely", () => {
    expect(canAssignRole("member", "viewer", "member")).toBe(false);
    expect(canAssignRole("viewer", "viewer", null)).toBe(false);
  });
});
