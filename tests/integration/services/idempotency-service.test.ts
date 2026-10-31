// tests/integration/services/idempotency-service.test.ts
// Integration tests for exactly-once mutations keyed by Idempotency-Key (SRS-SYNC-03),
// including concurrent duplicates and keys reused for a different request.

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/database/prisma-client";
import { ApiError } from "@/server/http/api-error";
import { computeRequestHash, runIdempotentOperation } from "@/server/services/idempotency-service";
import { createFixtureUser, wipeTestDatabase } from "../../helpers/test-database";

describe("runIdempotentOperation (SRS-SYNC-03)", () => {
  let userId: string;
  const requestHash = computeRequestHash("POST", "/api/example", '{"value":1}');

  beforeEach(async () => {
    await wipeTestDatabase();
    userId = (await createFixtureUser("td_idempotency", "TECHNICAL")).id;
  });

  it("runs the operation once and replays the stored response for a repeated key", async () => {
    let executionCount = 0;
    const operation = async () => {
      executionCount += 1;
      return { status: 201, body: { executionNumber: executionCount } };
    };
    const firstResponse = await runIdempotentOperation({ userId, idempotencyKey: "key-1", requestHash }, operation);
    const repeatedResponse = await runIdempotentOperation({ userId, idempotencyKey: "key-1", requestHash }, operation);

    expect(executionCount).toBe(1);
    expect(repeatedResponse).toEqual(firstResponse);
    expect(repeatedResponse).toEqual({ status: 201, body: { executionNumber: 1 } });
  });

  it("applies concurrent duplicates exactly once", async () => {
    const operation = async (database: Parameters<Parameters<typeof runIdempotentOperation>[1]>[0]) => {
      const createdPlayer = await database.tournament.create({
        data: { name: "Concurrency check", startDate: new Date(), endDate: new Date(), roundsCount: 1 },
      });
      return { status: 201, body: { tournamentId: createdPlayer.id } };
    };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => runIdempotentOperation({ userId, idempotencyKey: "key-race", requestHash }, operation)),
    );
    expect(await prisma.tournament.count()).toBe(1);
    expect(new Set(responses.map((response) => JSON.stringify(response))).size).toBe(1);
  });

  it("rejects a key reused for a different request with 422", async () => {
    await runIdempotentOperation({ userId, idempotencyKey: "key-2", requestHash }, async () => ({ status: 200, body: {} }));
    const otherRequestHash = computeRequestHash("POST", "/api/example", '{"value":2}');
    const error = await runIdempotentOperation(
      { userId, idempotencyKey: "key-2", requestHash: otherRequestHash },
      async () => ({ status: 200, body: {} }),
    ).catch((caughtError: unknown) => caughtError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ httpStatus: 422, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("stores nothing when the operation fails, so a retry re-evaluates", async () => {
    await expect(
      runIdempotentOperation({ userId, idempotencyKey: "key-3", requestHash }, async () => {
        throw new ApiError(409, "VERSION_CONFLICT", "conflict");
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
  });

  it("scopes keys per user", async () => {
    const otherUserId = (await createFixtureUser("td_other", "TECHNICAL")).id;
    let executionCount = 0;
    const operation = async () => ({ status: 200, body: { executionNumber: ++executionCount } });
    await runIdempotentOperation({ userId, idempotencyKey: "shared-key", requestHash }, operation);
    await runIdempotentOperation({ userId: otherUserId, idempotencyKey: "shared-key", requestHash }, operation);
    expect(executionCount).toBe(2);
  });
});
