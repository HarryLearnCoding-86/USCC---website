// src/server/validation/phase-two-input-schemas.ts
// Zod schemas for every Phase 2 request body and query: tournaments (SRS-TOUR-01..05), result codes,
// manual pairings (SRS-IMP-13) and result actions (SRS §10.2). Messages are Vietnamese because the
// first field error is shown to the arbiter as-is.

import { z } from "zod";
import { vi } from "@/i18n/vi";
import { MINIMUM_REASON_LENGTH } from "@/server/domain/result-state-machine";
import { HEX_COLOR_PATTERN, isValidTimezone, MAXIMUM_ROUNDS_COUNT, MINIMUM_ROUNDS_COUNT } from "@/server/domain/tournament-rules";

const optionalTrimmedText = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength, vi.validation.maxLength(maximumLength))
    .transform((text) => (text === "" ? null : text))
    .nullable()
    .optional()
    .transform((text) => text ?? null);

/** "YYYY-MM-DD" from an <input type="date">, parsed to UTC midnight for a DATE column. */
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, vi.validation.invalidFormat)
  .transform((dateText) => new Date(`${dateText}T00:00:00Z`))
  .refine((parsedDate) => !Number.isNaN(parsedDate.getTime()), vi.validation.invalidFormat);

const hexColorSchema = z
  .string()
  .regex(HEX_COLOR_PATTERN, vi.tournaments.invalidColor)
  .transform((color) => color.toLowerCase())
  .nullable()
  .optional()
  .transform((color) => color ?? null);

const tournamentFieldsSchema = z.object({
  name: z.string().trim().min(1, vi.validation.required).max(200, vi.validation.maxLength(200)),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  venue: optionalTrimmedText(200),
  organizer: optionalTrimmedText(200),
  roundsCount: z.coerce.number().int().min(MINIMUM_ROUNDS_COUNT).max(MAXIMUM_ROUNDS_COUNT),
  timezone: z.string().trim().default("Asia/Ho_Chi_Minh").refine(isValidTimezone, vi.tournaments.invalidTimezone),
  primaryColor: hexColorSchema,
  secondaryColor: hexColorSchema,
});

/** POST /api/tournaments and PATCH /api/tournaments/:id (full replacement of the editable fields). */
export const tournamentInputSchema = tournamentFieldsSchema.refine(
  (tournament) => tournament.endDate.getTime() >= tournament.startDate.getTime(),
  { message: vi.tournaments.endBeforeStart, path: ["endDate"] },
);

/** Scores are 0, 0.5 or 1 (SRS §9). */
const resultCodeScoreSchema = z.coerce
  .number()
  .refine((score) => score === 0 || score === 0.5 || score === 1, vi.resultCodes.invalidScore);

/** POST /api/tournaments/:id/result-codes. */
export const createResultCodeInputSchema = z.object({
  code: z.string().trim().min(1, vi.validation.required).max(20, vi.validation.maxLength(20)),
  labelVi: z.string().trim().min(1, vi.validation.required).max(100, vi.validation.maxLength(100)),
  whiteScore: resultCodeScoreSchema,
  blackScore: resultCodeScoreSchema,
  requiresPlayerConfirmation: z.boolean(),
  swissManagerValue: optionalTrimmedText(20),
  sortOrder: z.coerce.number().int().min(0).max(1000),
});

/** PATCH /api/tournaments/:id/result-codes/:codeId — any subset of fields. */
export const updateResultCodeInputSchema = createResultCodeInputSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((change) => Object.keys(change).length > 0, vi.validation.required);

const pointsBeforeSchema = z
  .union([z.number(), z.string().trim()])
  .transform((points) => (points === "" ? null : Number(points)))
  .refine((points) => points === null || (Number.isFinite(points) && points >= 0 && Number.isInteger(points * 2)), vi.resultCodes.invalidScore)
  .nullable()
  .optional()
  .transform((points) => points ?? null);

const pairingSideSchema = z.object({
  swissManagerPlayerId: optionalTrimmedText(30),
  fullName: z.string().trim().max(200, vi.validation.maxLength(200)),
  clubOrFederation: optionalTrimmedText(100),
  pointsBefore: pointsBeforeSchema,
});

/** POST / PUT a manual board (SRS-IMP-13). An empty Black name means a bye. */
export const manualPairingInputSchema = z
  .object({
    boardNumber: z.coerce.number(),
    white: pairingSideSchema.refine((side) => side.fullName.length > 0, { message: vi.validation.required, path: ["fullName"] }),
    black: pairingSideSchema,
  })
  .transform((pairing) => ({ ...pairing, black: pairing.black.fullName === "" ? null : pairing.black }));

const reasonSchema = z.string().max(1000, vi.validation.maxLength(1000));
const versionSchema = z.number().int().min(0);

/** POST /api/games/:id/result { resultCodeId, version }. */
export const submitResultInputSchema = z.object({ resultCodeId: z.string().min(1), version: versionSchema });

/** POST /api/games/:id/confirm { side, decision, version }. */
export const confirmResultInputSchema = z.object({
  side: z.enum(["WHITE", "BLACK"]),
  decision: z.enum(["CONFIRM", "REJECT"]),
  version: versionSchema,
});

/** POST /api/games/:id/approve { resultCodeId?, reason, version }. Reason length is enforced by the state machine. */
export const approveResultInputSchema = z.object({
  resultCodeId: z.string().min(1).nullable().optional().transform((resultCodeId) => resultCodeId ?? null),
  reason: reasonSchema,
  version: versionSchema,
});

/** POST /api/games/:id/edit { resultCodeId, reason, version }. */
export const editResultInputSchema = z.object({ resultCodeId: z.string().min(1), reason: reasonSchema, version: versionSchema });

/** POST /api/games/:id/reopen and /cancel { reason, version }. */
export const reasonOnlyInputSchema = z.object({ reason: reasonSchema, version: versionSchema });

/** GET /api/tournaments/:id/rounds/:n/games?search=&status= (SRS-LOOK-02, SRS-LOOK-03). */
export const roundGamesQuerySchema = z.object({
  search: z.string().trim().max(100).optional().default(""),
  status: z.enum(["NONE", "PENDING", "DISPUTED", "OFFICIAL", "REOPENED"]).optional(),
});

/** Route params that are positive integers in the URL. */
export const positiveIntegerParamSchema = z.coerce.number().int().positive();

/** Re-exported so callers can show the rule. */
export { MINIMUM_REASON_LENGTH };

/** Parsed tournament body. */
export type TournamentInput = z.infer<typeof tournamentInputSchema>;
/** Parsed create-result-code body. */
export type CreateResultCodeInput = z.infer<typeof createResultCodeInputSchema>;
/** Parsed update-result-code body. */
export type UpdateResultCodeInput = z.infer<typeof updateResultCodeInputSchema>;
/** Parsed manual pairing body. */
export type ManualPairingInput = z.infer<typeof manualPairingInputSchema>;
