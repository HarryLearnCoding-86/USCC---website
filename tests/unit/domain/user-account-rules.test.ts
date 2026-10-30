// tests/unit/domain/user-account-rules.test.ts
// Unit tests for the deactivation rules (SRS-AUTH-08 last active TD, self-deactivation guard).

import { describe, expect, it } from "vitest";
import { findDeactivationRefusalReason, type DeactivationContext } from "@/server/domain/user-account-rules";

const baseContext: DeactivationContext = {
  actingUserId: "td-1",
  targetUserId: "td-2",
  targetRole: "TECHNICAL",
  isTargetActive: true,
  activeTechnicalAccountCount: 2,
};

describe("findDeactivationRefusalReason", () => {
  it("allows deactivating a TD while another active TD remains", () => {
    expect(findDeactivationRefusalReason(baseContext)).toBeNull();
  });

  it("refuses deactivating the last active TD (SRS-AUTH-08)", () => {
    expect(findDeactivationRefusalReason({ ...baseContext, activeTechnicalAccountCount: 1 })).toBe(
      "LAST_ACTIVE_TECHNICAL",
    );
  });

  it("refuses self-deactivation", () => {
    expect(findDeactivationRefusalReason({ ...baseContext, targetUserId: "td-1" })).toBe("SELF_DEACTIVATION");
  });

  it("always allows deactivating a recorder", () => {
    expect(
      findDeactivationRefusalReason({ ...baseContext, targetRole: "RECORDER", activeTechnicalAccountCount: 1 }),
    ).toBeNull();
  });

  it("treats deactivating an already inactive account as a no-op", () => {
    expect(
      findDeactivationRefusalReason({ ...baseContext, isTargetActive: false, activeTechnicalAccountCount: 0 }),
    ).toBeNull();
  });
});
