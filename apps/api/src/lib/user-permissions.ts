import type { Role } from "@hostpanel/types";

export type UserActor = { sub: string; role: Role };
export type UserTarget = { id: string; role: Role };

const STAFF: Role[] = ["superadmin", "admin"];

export function isStaffRole(role: Role): boolean {
  return STAFF.includes(role);
}

/** Roles an actor may assign when creating or updating users. */
export function assignableRoles(actorRole: Role): Role[] {
  if (actorRole === "superadmin") return ["superadmin", "admin", "editor", "viewer"];
  if (actorRole === "admin") return ["editor", "viewer"];
  return [];
}

export function canAssignRole(actorRole: Role, role: Role): boolean {
  return assignableRoles(actorRole).includes(role);
}

/** Whether actor may view the user list / a specific account in admin UI. */
export function canManageUserAccounts(actorRole: Role): boolean {
  return isStaffRole(actorRole);
}

/** Whether actor may edit the target user (name, email, role, docker, password). */
export function canEditUser(actor: UserActor, target: UserTarget): boolean {
  if (!canManageUserAccounts(actor.role)) return false;
  if (actor.sub === target.id) return false; // use profile / change-password
  if (actor.role === "superadmin") return true;
  if (actor.role === "admin") {
    return target.role === "editor" || target.role === "viewer";
  }
  return false;
}

/** Whether actor may delete the target user. */
export function canDeleteUser(actor: UserActor, target: UserTarget): boolean {
  if (!canManageUserAccounts(actor.role)) return false;
  if (actor.sub === target.id) return false;
  if (actor.role === "superadmin") return true;
  if (actor.role === "admin") {
    return target.role === "editor" || target.role === "viewer";
  }
  return false;
}

/** Normalize docker flag: staff roles always have implicit docker access. */
export function normalizeDockerAccess(role: Role, dockerAccess: boolean | undefined): boolean {
  if (role === "superadmin" || role === "admin") return false;
  return Boolean(dockerAccess);
}
