import type { Role } from "@hostpanel/types";

export function isStaffRole(role: Role): boolean {
  return role === "superadmin" || role === "admin";
}

/** Panel operator vs tenant user */
export function canAccessSite(role: Role, userId: string, siteOwnerId: string): boolean {
  if (isStaffRole(role)) return true;
  return userId === siteOwnerId;
}
