// src/server/auth/account-input-schemas.ts
// Zod schemas for every auth and account-management request body (AGENT_PROMPT.md §1.3: validate all input).
// Error messages are Vietnamese strings from vi.ts because they are shown to arbiters as-is.

import { z } from "zod";
import { vi } from "@/i18n/vi";

/** Minimum password length for arbiter accounts. Long passphrases beat complexity rules. */
export const MINIMUM_PASSWORD_LENGTH = 10;
/** Upper bound so a huge body cannot make argon2 hash megabytes of input. */
export const MAXIMUM_PASSWORD_LENGTH = 200;

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, vi.validation.minLength(3))
  .max(40, vi.validation.maxLength(40))
  .regex(/^[a-z0-9._-]+$/, vi.adminUsers.usernameHint);

const newPasswordSchema = z
  .string()
  .min(MINIMUM_PASSWORD_LENGTH, vi.validation.passwordTooShort(MINIMUM_PASSWORD_LENGTH))
  .max(MAXIMUM_PASSWORD_LENGTH, vi.validation.maxLength(MAXIMUM_PASSWORD_LENGTH));

/**
 * POST /api/auth/login body. The password is not length-checked against the creation rules:
 * a login must fail with the generic message, never reveal which rule an attempt broke.
 */
export const loginInputSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, vi.validation.required).max(40),
  password: z.string().min(1, vi.validation.required).max(MAXIMUM_PASSWORD_LENGTH),
});

/** POST /api/users body (SRS-AUTH-02: only a TECHNICAL user creates accounts). */
export const createUserInputSchema = z.object({
  username: usernameSchema,
  password: newPasswordSchema,
  role: z.enum(["TECHNICAL", "RECORDER"]),
});

/**
 * PATCH /api/users/:id body (SRS-AUTH-07). Exactly one change per request keeps the audit of
 * each action clear: either toggle activation or reset the password.
 */
export const updateUserInputSchema = z.union([
  z.object({ isActive: z.boolean() }).strict(),
  z.object({ newPassword: newPasswordSchema }).strict(),
]);

/** Parsed login body. */
export type LoginInput = z.infer<typeof loginInputSchema>;
/** Parsed create-user body. */
export type CreateUserInput = z.infer<typeof createUserInputSchema>;
/** Parsed update-user body. */
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
