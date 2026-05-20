import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  canAssignRole,
  canDeleteUser,
  canEditUser,
} from "./user-permissions.js";

describe("user-permissions", () => {
  const superadmin = { sub: "sa", role: "superadmin" as const };
  const admin = { sub: "ad", role: "admin" as const };
  const editor = { id: "ed", role: "editor" as const };
  const viewer = { id: "vw", role: "viewer" as const };
  const otherAdmin = { id: "ad2", role: "admin" as const };

  it("superadmin can assign all roles", () => {
    expect(assignableRoles("superadmin")).toEqual(["superadmin", "admin", "editor", "viewer"]);
    expect(canAssignRole("superadmin", "admin")).toBe(true);
  });

  it("admin can only assign editor and viewer", () => {
    expect(assignableRoles("admin")).toEqual(["editor", "viewer"]);
    expect(canAssignRole("admin", "admin")).toBe(false);
    expect(canAssignRole("admin", "editor")).toBe(true);
  });

  it("admin cannot edit or delete staff accounts", () => {
    expect(canEditUser(admin, { id: "sa", role: "superadmin" })).toBe(false);
    expect(canEditUser(admin, otherAdmin)).toBe(false);
    expect(canDeleteUser(admin, otherAdmin)).toBe(false);
    expect(canEditUser(admin, editor)).toBe(true);
    expect(canDeleteUser(admin, viewer)).toBe(true);
  });

  it("superadmin can edit and delete non-self users", () => {
    expect(canEditUser(superadmin, editor)).toBe(true);
    expect(canDeleteUser(superadmin, editor)).toBe(true);
    expect(canDeleteUser({ sub: "sa", role: "superadmin" }, { id: "sa", role: "superadmin" })).toBe(false);
  });
});
