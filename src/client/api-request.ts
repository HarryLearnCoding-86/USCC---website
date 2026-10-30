// src/client/api-request.ts
// Browser helper for calling the JSON API. Every mutation gets a fresh Idempotency-Key, which the
// server requires (SRS-SYNC-03) and the Phase 3 offline queue will persist and replay.

/** Uniform result of an API call: ok flag, HTTP status and parsed JSON body. */
export interface ApiRequestResult<TResponseBody> {
  isOk: boolean;
  status: number;
  body: TResponseBody;
}

/** Error body shape returned by every failing endpoint (SRS §10.2). */
export interface ApiErrorResponseBody {
  code: string;
  messageVi: string;
}

/**
 * Generates a random UUID v4 for the Idempotency-Key header.
 * crypto.randomUUID exists only in secure contexts; on plain-http LAN testing we build one from getRandomValues.
 *
 * @returns A UUID v4 string.
 */
export function generateIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  // RFC 4122 §4.4: set the version (4) and variant (10xx) bits.
  randomBytes[6] = ((randomBytes[6] ?? 0) & 0x0f) | 0x40;
  randomBytes[8] = ((randomBytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Sends a JSON mutation (POST/PATCH/DELETE) with a new Idempotency-Key.
 *
 * @param httpMethod - "POST", "PATCH" or "DELETE".
 * @param path - Same-origin API path, e.g. "/api/users".
 * @param requestBody - JSON-serialisable body, or undefined for none.
 * @returns The status and parsed body; network failures reject the promise.
 */
export async function sendJsonMutation<TResponseBody>(
  httpMethod: "POST" | "PATCH" | "DELETE",
  path: string,
  requestBody?: unknown,
): Promise<ApiRequestResult<TResponseBody>> {
  const response = await fetch(path, {
    method: httpMethod,
    headers: { "Content-Type": "application/json", "Idempotency-Key": generateIdempotencyKey() },
    body: requestBody === undefined ? null : JSON.stringify(requestBody),
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as TResponseBody;
  return { isOk: response.ok, status: response.status, body };
}
