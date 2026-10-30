// src/server/services/result-code-service.ts
// Per-tournament result-code management (SRS-TOUR-05, SRS-TOUR-07). A code already used by a result cannot be
// deleted, and its meaning (code, scores, whether players confirm) cannot change, because that would silently
// rewrite existing results; it can only be hidden, relabelled, re-ordered or given a new Swiss-Manager value.

import { vi } from "@/i18n/vi";
import type { DatabaseClient } from "@/server/database/database-client";
import { ApiError } from "@/server/http/api-error";
import { notifyTournamentChanged } from "@/server/services/change-notifier";
import { toResultCodeView, type ResultCodeView } from "@/server/services/game-view-mapper";
import { isUniqueConstraintViolation } from "@/server/services/idempotency-service";
import type { CreateResultCodeInput, UpdateResultCodeInput } from "@/server/validation/phase-two-input-schemas";

/** Fields that define what a code means; frozen once results use it. */
const MEANING_FIELDS = ["code", "whiteScore", "blackScore", "requiresPlayerConfirmation"] as const;

/**
 * Creates a result code.
 *
 * @param tournamentId - Owning tournament.
 * @param createInput - Validated fields.
 * @param database - Transaction client of the request.
 * @returns The new code.
 * @throws ApiError 404 TOURNAMENT_NOT_FOUND; 409 RESULT_CODE_TAKEN.
 */
export async function createResultCode(
  tournamentId: string,
  createInput: CreateResultCodeInput,
  database: DatabaseClient,
): Promise<ResultCodeView> {
  if ((await database.tournament.count({ where: { id: tournamentId } })) === 0) {
    throw new ApiError(404, "TOURNAMENT_NOT_FOUND", vi.tournaments.tournamentNotFound);
  }
  try {
    return toResultCodeView(await database.resultCode.create({ data: { tournamentId, ...createInput } }));
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ApiError(409, "RESULT_CODE_TAKEN", vi.resultCodes.codeTaken);
    }
    throw error;
  }
}

/**
 * Updates a result code, refusing meaning changes on a used code.
 *
 * @param tournamentId - Owning tournament (guards against cross-tournament IDs).
 * @param resultCodeId - Code to change.
 * @param updateInput - Fields to change.
 * @param database - Transaction client of the request.
 * @returns The updated code.
 * @throws ApiError 404 RESULT_CODE_NOT_FOUND; 409 RESULT_CODE_IN_USE or RESULT_CODE_TAKEN.
 */
export async function updateResultCode(
  tournamentId: string,
  resultCodeId: string,
  updateInput: UpdateResultCodeInput,
  database: DatabaseClient,
): Promise<ResultCodeView> {
  const usageCount = await countResultCodeUsage(tournamentId, resultCodeId, database);
  const isChangingMeaning = MEANING_FIELDS.some((fieldName) => updateInput[fieldName] !== undefined);
  if (usageCount > 0 && isChangingMeaning) {
    throw new ApiError(409, "RESULT_CODE_IN_USE", vi.resultCodes.inUse);
  }
  const changedFields = Object.fromEntries(Object.entries(updateInput).filter(([, fieldValue]) => fieldValue !== undefined));
  try {
    const updatedResultCode = toResultCodeView(await database.resultCode.update({ where: { id: resultCodeId }, data: changedFields }));
    // A relabelled code changes what the projection shows for official results.
    await notifyTournamentChanged({ tournamentId }, database);
    return updatedResultCode;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ApiError(409, "RESULT_CODE_TAKEN", vi.resultCodes.codeTaken);
    }
    throw error;
  }
}

/**
 * Deletes an unused result code (SRS-TOUR-07).
 *
 * @param tournamentId - Owning tournament.
 * @param resultCodeId - Code to delete.
 * @param database - Transaction client of the request.
 * @throws ApiError 404 RESULT_CODE_NOT_FOUND; 409 RESULT_CODE_IN_USE.
 */
export async function deleteResultCode(tournamentId: string, resultCodeId: string, database: DatabaseClient): Promise<void> {
  if ((await countResultCodeUsage(tournamentId, resultCodeId, database)) > 0) {
    throw new ApiError(409, "RESULT_CODE_IN_USE", vi.resultCodes.inUse);
  }
  await database.resultCode.delete({ where: { id: resultCodeId } });
}

/**
 * Counts results that reference a code, current or past. Past use is read from the audit log, so a code that
 * was used and later replaced is still protected: deleting it would make history unreadable.
 *
 * @param tournamentId - Owning tournament.
 * @param resultCodeId - Code ID.
 * @param database - Transaction client.
 * @returns Number of references.
 * @throws ApiError 404 RESULT_CODE_NOT_FOUND when the code does not belong to the tournament.
 */
async function countResultCodeUsage(tournamentId: string, resultCodeId: string, database: DatabaseClient): Promise<number> {
  const resultCode = await database.resultCode.findFirst({ where: { id: resultCodeId, tournamentId }, select: { id: true } });
  if (!resultCode) {
    throw new ApiError(404, "RESULT_CODE_NOT_FOUND", vi.resultCodes.notFound);
  }
  const currentUsage = await database.result.count({ where: { resultCodeId } });
  const [historicalUsage] = await database.$queryRaw<{ usage_count: bigint }[]>`
    SELECT count(*) AS usage_count FROM result_events
    WHERE old_value->>'resultCodeId' = ${resultCodeId} OR new_value->>'resultCodeId' = ${resultCodeId}`;
  return currentUsage + Number(historicalUsage?.usage_count ?? 0);
}
