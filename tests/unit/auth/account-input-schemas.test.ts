// tests/unit/auth/account-input-schemas.test.ts
// Unit tests for Zod validation of login and account-management bodies (AGENT_PROMPT.md §1.3).

import { describe, expect, it } from "vitest";
import {
  createUserInputSchema,
  loginInputSchema,
  MINIMUM_PASSWORD_LENGTH,
  updateUserInputSchema,
} from "@/server/auth/account-input-schemas";

describe("loginInputSchema", () => {
  it("trims and lower-cases the username", () => {
    expect(loginInputSchema.parse({ username: "  TD_Demo ", password: "x" }).username).toBe("td_demo");
  });

  it("rejects empty fields and non-object bodies", () => {
    expect(loginInputSchema.safeParse({ username: "", password: "x" }).success).toBe(false);
    expect(loginInputSchema.safeParse({ username: "td", password: "" }).success).toBe(false);
    expect(loginInputSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("createUserInputSchema (SRS-AUTH-02)", () => {
  const validInput = { username: "recorder.01", password: "a".repeat(MINIMUM_PASSWORD_LENGTH), role: "RECORDER" };

  it("accepts a valid account", () => {
    expect(createUserInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects short passwords, bad usernames and unknown roles", () => {
    expect(createUserInputSchema.safeParse({ ...validInput, password: "short" }).success).toBe(false);
    expect(createUserInputSchema.safeParse({ ...validInput, username: "có dấu" }).success).toBe(false);
    expect(createUserInputSchema.safeParse({ ...validInput, username: "ab" }).success).toBe(false);
    expect(createUserInputSchema.safeParse({ ...validInput, role: "ADMIN" }).success).toBe(false);
  });
});

describe("updateUserInputSchema (SRS-AUTH-07)", () => {
  it("accepts exactly one change per request", () => {
    expect(updateUserInputSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateUserInputSchema.safeParse({ newPassword: "b".repeat(MINIMUM_PASSWORD_LENGTH) }).success).toBe(true);
  });

  it("rejects mixed, empty or unknown changes", () => {
    expect(updateUserInputSchema.safeParse({ isActive: true, newPassword: "b".repeat(12) }).success).toBe(false);
    expect(updateUserInputSchema.safeParse({}).success).toBe(false);
    expect(updateUserInputSchema.safeParse({ role: "TECHNICAL" }).success).toBe(false);
  });
});
