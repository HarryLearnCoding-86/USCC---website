// src/server/auth/role-permissions.ts
// The role → permission matrix from SRS §4.1, as data plus one lookup function.
// Every server-side guard asks this module; the UI may hide buttons, but only this decides (SRS-AUTH-06).

import type { Role } from "@prisma/client";

/** Actions an arbiter may be allowed to perform, one per row of the SRS permission matrix. */
export const PERMISSIONS = [
  "MANAGE_TOURNAMENTS",
  "IMPORT_PAIRINGS",
  "LOOK_UP_GAMES",
  "SUBMIT_RESULTS",
  "RESOLVE_RESULTS",
  "VIEW_PROJECTION",
  "EXPORT_RESULTS",
  "MANAGE_ACCOUNTS",
] as const;

/** One permission name. */
export type Permission = (typeof PERMISSIONS)[number];

/**
 * SRS §4.1 permission matrix. TECHNICAL can do everything; RECORDER can only look up games and
 * submit results / run confirmations. RESOLVE_RESULTS covers approve exception, edit, cancel, reopen.
 */
const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  TECHNICAL: new Set<Permission>(PERMISSIONS),
  RECORDER: new Set<Permission>(["LOOK_UP_GAMES", "SUBMIT_RESULTS"]),
};

/**
 * Checks whether a role grants a permission.
 *
 * @param role - The arbiter's role.
 * @param permission - The action being attempted.
 * @returns true when the role is allowed to perform the action.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
