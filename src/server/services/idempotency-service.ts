// src/server/services/idempotency-service.ts
// Exactly-once execution of mutating requests keyed by the client's Idempotency-Key (SRS-SYNC-03).
// The operation and the stored response are written in the same transaction, so a retried request
// (e.g. from the offline queue) either sees the stored response or runs the operation — never both.

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { vi } from "@/i18n/vi";
import { prisma } from "@/server/database/prisma-client";
import type { DatabaseClient } from "@/server/database/database-client";
import { ApiError } from "@/server/http/api-error";

/** A response produced by a mutating operation: HTTP status plus JSON body. */
export interface StoredApiResponse {
  status: number;
  body: Prisma.InputJsonValue;
}

/** Identifies one logical request. */
export interface IdempotentRequestIdentity {
  userId: string;
  idempotencyKey: string;
  /** Hash from computeRequestHash; detects a key reused for a different request. */
  requestHash: string;
}

/** SRS §9: idempotency records are kept at least 48 hours. */
export const IDEMPOTENCY_RECORD_RETENTION_HOURS = 48;

/**
 * Hashes the parts of a request that define "the same request".
 *
 * @param httpMethod - Request method.
 * @param pathname - URL path without query string.
 * @param requestBodyText - Raw request body ("" when empty).
 * @returns Hex SHA-256 digest.
 */
export function computeRequestHash(httpMethod: string, pathname: string, requestBodyText: string): string {
  return createHash("sha256").update(`${httpMethod.toUpperCase()}\n${pathname}\n${requestBodyText}`).digest("hex");
}

/**
 * Runs a mutating operation once per (user, idempotency key).
 * Failures (thrown errors) roll back and store nothing, so a retry re-evaluates and normally gets the same
 * rejection, which the offline queue then drops (SRS-SYNC-04).
 *
 * @param requestIdentity - User, key and request hash.
 * @param operation - The use case; receives the transaction client and must do all writes through it.
 * @returns The operation's response, or the stored response of the first execution.
 * @throws ApiError 422 IDEMPOTENCY_KEY_REUSED when the key was used for a different request.
 */
export async function runIdempotentOperation(
  requestIdentity: IdempotentRequestIdentity,
  operation: (database: DatabaseClient) => Promise<StoredApiResponse>,
): Promise<StoredApiResponse> {
  const existingResponse = await findStoredResponse(requestIdentity);
  if (existingResponse) {
    return existingResponse;
  }
  try {
    return await prisma.$transaction(
      async (transaction) => {
        const response = await operation(transaction);
        await transaction.idempotencyRecord.create({
          data: {
            userId: requestIdentity.userId,
            idempotencyKey: requestIdentity.idempotencyKey,
            requestHash: requestIdentity.requestHash,
            responseStatus: response.status,
            responseBody: response.body,
          },
        });
        return response;
      },
      // Prisma's default 5 s timeout is too short for a whole-round import (up to ~100 boards, SRS-IMP-10),
      // which must still run as one transaction.
      { maxWait: 10_000, timeout: 60_000 },
    );
  } catch (error) {
    // A concurrent duplicate committed first: our transaction rolled back, so return the winner's response.
    if (isUniqueConstraintViolation(error)) {
      const winningResponse = await findStoredResponse(requestIdentity);
      if (winningResponse) {
        return winningResponse;
      }
    }
    throw error;
  }
}

/**
 * Deletes idempotency records older than the retention window.
 *
 * @param now - Current time.
 * @returns Number of records deleted.
 */
export async function deleteExpiredIdempotencyRecords(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_RECORD_RETENTION_HOURS * 60 * 60 * 1000);
  const deletion = await prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return deletion.count;
}

/**
 * Looks up the stored response for a request identity.
 *
 * @param requestIdentity - User, key and request hash.
 * @returns The stored response, or null when the key is new.
 * @throws ApiError 422 when the key exists with a different request hash.
 */
async function findStoredResponse(requestIdentity: IdempotentRequestIdentity): Promise<StoredApiResponse | null> {
  const storedRecord = await prisma.idempotencyRecord.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: requestIdentity.userId,
        idempotencyKey: requestIdentity.idempotencyKey,
      },
    },
  });
  if (!storedRecord) {
    return null;
  }
  if (storedRecord.requestHash !== requestIdentity.requestHash) {
    throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", vi.apiErrors.idempotencyKeyReused);
  }
  return { status: storedRecord.responseStatus, body: storedRecord.responseBody as Prisma.InputJsonValue };
}

/**
 * Detects Prisma's unique-constraint error (P2002).
 *
 * @param error - Anything thrown.
 * @returns true for a unique-constraint violation.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
