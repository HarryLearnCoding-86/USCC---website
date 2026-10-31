// tests/unit/auth/phase-five-security-rules.test.ts
// Unit tests for Phase 5 hardening rules: the per-username login lockout (SRS-AUTH-05), CSRF token derivation and
// comparison (SRS §10.2), and secret redaction in structured logs (NFR-14).

import { describe, expect, it } from "vitest";
import { deriveCsrfToken, isCsrfTokenValid } from "@/server/auth/csrf-token";
import { evaluateLoginLock, LOGIN_LOCK_DURATION_MILLISECONDS } from "@/server/domain/login-throttle-rules";
import { redactSecretFields } from "@/server/observability/server-logger";
import { computeCsrfTokenForTest } from "../../helpers/csrf-test-token";

const START = new Date("2026-10-31T08:00:00Z").getTime();
const minutes = (count: number) => count * 60 * 1000;
const failureAt = (offsetMilliseconds: number) => ({ wasSuccessful: false, attemptedAt: new Date(START + offsetMilliseconds) });
const successAt = (offsetMilliseconds: number) => ({ wasSuccessful: true, attemptedAt: new Date(START + offsetMilliseconds) });

describe("evaluateLoginLock (SRS-AUTH-05: 5 failures in 10 minutes → 10-minute lock)", () => {
  const fiveFailures = [0, 1, 2, 3, 4].map((minute) => failureAt(minutes(minute)));

  it("does not lock after 4 failures", () => {
    expect(evaluateLoginLock(fiveFailures.slice(0, 4), new Date(START + minutes(5)))).toEqual({ isLocked: false });
  });

  it("locks for 10 minutes from the fifth failure", () => {
    const lockState = evaluateLoginLock(fiveFailures, new Date(START + minutes(5)));
    expect(lockState).toEqual({ isLocked: true, lockedUntil: new Date(START + minutes(4) + LOGIN_LOCK_DURATION_MILLISECONDS), retryAfterSeconds: 9 * 60 });
    expect(evaluateLoginLock(fiveFailures, new Date(START + minutes(14)))).toEqual({ isLocked: false });
  });

  it("ignores failures spread over more than 10 minutes", () => {
    const spreadFailures = [0, 3, 6, 9, 12].map((minute) => failureAt(minutes(minute)));
    expect(evaluateLoginLock(spreadFailures, new Date(START + minutes(12)))).toEqual({ isLocked: false });
  });

  it("only counts failures after the last successful login", () => {
    const attempts = [failureAt(0), failureAt(minutes(1)), failureAt(minutes(2)), successAt(minutes(3)), failureAt(minutes(4)), failureAt(minutes(5))];
    expect(evaluateLoginLock(attempts, new Date(START + minutes(6)))).toEqual({ isLocked: false });
  });

  it("accepts attempts in any order", () => {
    expect(evaluateLoginLock([...fiveFailures].reverse(), new Date(START + minutes(5))).isLocked).toBe(true);
  });
});

describe("CSRF tokens (SRS §10.2)", () => {
  it("derives a stable base64url token per session, different across sessions", async () => {
    const firstToken = await deriveCsrfToken("session-token-a");
    expect(firstToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await deriveCsrfToken("session-token-a")).toBe(firstToken);
    expect(await deriveCsrfToken("session-token-b")).not.toBe(firstToken);
    expect(firstToken).not.toContain("session-token-a");
  });

  it("matches the synchronous derivation used by the test request builders", async () => {
    expect(await deriveCsrfToken("session-token-a")).toBe(computeCsrfTokenForTest("session-token-a"));
  });

  it("accepts only the matching token", async () => {
    const validToken = await deriveCsrfToken("session-token-a");
    expect(await isCsrfTokenValid("session-token-a", validToken)).toBe(true);
    expect(await isCsrfTokenValid("session-token-b", validToken)).toBe(false);
    expect(await isCsrfTokenValid("session-token-a", null)).toBe(false);
    expect(await isCsrfTokenValid(undefined, validToken)).toBe(false);
    expect(await isCsrfTokenValid("session-token-a", `${validToken}x`)).toBe(false);
  });
});

describe("redactSecretFields (NFR-14)", () => {
  it("never writes passwords, tokens or cookies, at any depth", () => {
    expect(
      redactSecretFields({ requestId: "r1", password: "p", sessionToken: "t", nested: { cookieHeader: "c", path: "/api" } }),
    ).toEqual({ requestId: "r1", password: "[redacted]", sessionToken: "[redacted]", nested: { cookieHeader: "[redacted]", path: "/api" } });
  });
});
