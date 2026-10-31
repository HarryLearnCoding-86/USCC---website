// tests/unit/auth/password-hasher.test.ts
// Unit tests for argon2id password hashing (SRS-AUTH-03).

import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password-hasher";

describe("password hashing (SRS-AUTH-03)", () => {
  it("stores an argon2id hash, never the plain password", async () => {
    const passwordHash = await hashPassword("Correct-Horse-1");
    expect(passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(passwordHash).not.toContain("Correct-Horse-1");
  });

  it("salts each hash, so equal passwords give different hashes", async () => {
    expect(await hashPassword("Same-Password-1")).not.toBe(await hashPassword("Same-Password-1"));
  });

  it("verifies the correct password and rejects a wrong one", async () => {
    const passwordHash = await hashPassword("Correct-Horse-1");
    expect(await verifyPassword(passwordHash, "Correct-Horse-1")).toBe(true);
    expect(await verifyPassword(passwordHash, "correct-horse-1")).toBe(false);
  });

  it("returns false instead of throwing on a malformed stored hash", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });
});
