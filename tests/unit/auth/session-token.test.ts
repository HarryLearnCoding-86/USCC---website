// tests/unit/auth/session-token.test.ts
// Unit tests for session token generation, hashing and sliding expiry (SRS-AUTH-04).

import { describe, expect, it } from "vitest";
import {
  computeSessionExpiry,
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  SESSION_REFRESH_INTERVAL_MILLISECONDS,
  shouldRefreshSession,
} from "@/server/auth/session-token";

describe("generateSessionToken", () => {
  it("produces 43-character base64url tokens", () => {
    expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats across many generations", () => {
    const generatedTokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(generatedTokens.size).toBe(1000);
  });
});

describe("hashSessionToken", () => {
  it("is deterministic, hex, and differs from the raw token", () => {
    const sessionToken = generateSessionToken();
    expect(hashSessionToken(sessionToken)).toBe(hashSessionToken(sessionToken));
    expect(hashSessionToken(sessionToken)).not.toBe(sessionToken);
    expect(hashSessionToken(sessionToken)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives different hashes for different tokens", () => {
    expect(hashSessionToken("token-a")).not.toBe(hashSessionToken("token-b"));
  });
});

describe("sliding expiry (SRS-AUTH-04: 16 h of inactivity)", () => {
  const lastActivityAt = new Date("2026-10-30T02:00:00Z");

  it("expires exactly idleTimeoutHours after the last activity", () => {
    expect(computeSessionExpiry(lastActivityAt, 16).toISOString()).toBe("2026-10-30T18:00:00.000Z");
  });

  it("treats the expiry instant itself as expired", () => {
    const expiresAt = computeSessionExpiry(lastActivityAt, 16);
    expect(isSessionExpired(expiresAt, new Date(expiresAt.getTime() - 1))).toBe(false);
    expect(isSessionExpired(expiresAt, expiresAt)).toBe(true);
  });

  it("refreshes only after the refresh interval has passed", () => {
    const justBefore = new Date(lastActivityAt.getTime() + SESSION_REFRESH_INTERVAL_MILLISECONDS - 1);
    const exactlyAt = new Date(lastActivityAt.getTime() + SESSION_REFRESH_INTERVAL_MILLISECONDS);
    expect(shouldRefreshSession(lastActivityAt, justBefore)).toBe(false);
    expect(shouldRefreshSession(lastActivityAt, exactlyAt)).toBe(true);
  });
});
