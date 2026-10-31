// tests/unit/auth/same-origin-check.test.ts
// Unit tests for the cross-site request check on mutations (NFR-07).

import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/server/auth/same-origin-check";

const ALLOWED_ORIGINS = ["https://kq.example.test"];

describe("isSameOriginRequest (NFR-07)", () => {
  it.each(["GET", "HEAD", "OPTIONS", "get"])("lets safe method %s through without an Origin", (httpMethod) => {
    expect(isSameOriginRequest(httpMethod, null, ALLOWED_ORIGINS)).toBe(true);
  });

  it("accepts a mutation from the app's own origin, ignoring a trailing path", () => {
    expect(isSameOriginRequest("POST", "https://kq.example.test", ALLOWED_ORIGINS)).toBe(true);
    expect(isSameOriginRequest("PATCH", "https://kq.example.test", ["https://kq.example.test/"])).toBe(true);
  });

  it("rejects a mutation from another site, scheme or port", () => {
    expect(isSameOriginRequest("POST", "https://evil.example.test", ALLOWED_ORIGINS)).toBe(false);
    expect(isSameOriginRequest("POST", "http://kq.example.test", ALLOWED_ORIGINS)).toBe(false);
    expect(isSameOriginRequest("POST", "https://kq.example.test:8443", ALLOWED_ORIGINS)).toBe(false);
  });

  it("rejects a mutation with no Origin header or a malformed one", () => {
    expect(isSameOriginRequest("DELETE", null, ALLOWED_ORIGINS)).toBe(false);
    expect(isSameOriginRequest("POST", "null", ALLOWED_ORIGINS)).toBe(false);
  });
});
