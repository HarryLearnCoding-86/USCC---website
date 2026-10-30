// tests/unit/auth/role-permissions.test.ts
// Unit tests for the SRS §4.1 permission matrix, checked cell by cell (SRS-AUTH-06).

import { describe, expect, it } from "vitest";
import { hasPermission, PERMISSIONS, type Permission } from "@/server/auth/role-permissions";

/** Expected matrix copied from SRS §4.1. */
const EXPECTED_RECORDER_PERMISSIONS: Record<Permission, boolean> = {
  MANAGE_TOURNAMENTS: false,
  IMPORT_PAIRINGS: false,
  LOOK_UP_GAMES: true,
  SUBMIT_RESULTS: true,
  RESOLVE_RESULTS: false,
  VIEW_PROJECTION: false,
  EXPORT_RESULTS: false,
  MANAGE_ACCOUNTS: false,
};

describe("permission matrix (SRS §4.1)", () => {
  it.each(PERMISSIONS)("TECHNICAL holds %s", (permission) => {
    expect(hasPermission("TECHNICAL", permission)).toBe(true);
  });

  it.each(PERMISSIONS)("RECORDER matches the SRS matrix for %s", (permission) => {
    expect(hasPermission("RECORDER", permission)).toBe(EXPECTED_RECORDER_PERMISSIONS[permission]);
  });
});
