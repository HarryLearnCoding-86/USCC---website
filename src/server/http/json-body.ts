// src/server/http/json-body.ts
// Converts a typed view object into the JSON value type that idempotency records store.
// View interfaces are JSON-safe by construction (strings, numbers, booleans, null, arrays, plain objects),
// but TypeScript cannot prove an interface satisfies Prisma's index-signature JSON type; this narrows it once.

import type { Prisma } from "@prisma/client";

/**
 * Returns a JSON-safe view as Prisma.InputJsonValue.
 *
 * @param viewValue - A view built from strings, numbers, booleans, null, arrays and plain objects only.
 * @returns The same value, typed for storage and NextResponse.json.
 */
export function toJsonBody(viewValue: object): Prisma.InputJsonValue {
  // Interfaces lack an index signature, so this cast is the narrowest safe bridge (no runtime change).
  return viewValue as Prisma.InputJsonValue;
}
