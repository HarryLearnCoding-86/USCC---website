// tests/unit/client/api-request.test.ts
// Unit tests for client idempotency-key generation (SRS-SYNC-03), including the non-secure-context fallback.

import { describe, expect, it } from "vitest";
import { generateIdempotencyKey } from "@/client/api-request";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateIdempotencyKey", () => {
  it("returns a UUID v4", () => {
    expect(generateIdempotencyKey()).toMatch(UUID_V4_PATTERN);
  });

  it("falls back to getRandomValues when randomUUID is unavailable (plain-http LAN)", () => {
    const originalRandomUuid = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const generatedKeys = new Set(Array.from({ length: 50 }, () => generateIdempotencyKey()));
      expect(generatedKeys.size).toBe(50);
      for (const generatedKey of generatedKeys) {
        expect(generatedKey).toMatch(UUID_V4_PATTERN);
      }
    } finally {
      if (originalRandomUuid) {
        Object.defineProperty(crypto, "randomUUID", originalRandomUuid);
      } else {
        delete (crypto as { randomUUID?: unknown }).randomUUID;
      }
    }
  });
});
