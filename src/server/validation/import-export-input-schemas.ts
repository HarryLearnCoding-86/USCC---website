// src/server/validation/import-export-input-schemas.ts
// Zod schemas for the import wizard bodies (SRS-IMP-02..09) and the export query (SRS-EXP-01, 03, 04).

import { z } from "zod";
import { PAIRING_IMPORT_FIELDS } from "@/server/domain/pairing-import-rules";

const columnLetterSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}$/);

/** Field → column letter; empty strings mean "not mapped". */
const columnMappingSchema = z
  .record(z.string(), z.string().optional())
  .transform((rawMapping) =>
    Object.fromEntries(
      Object.entries(rawMapping).filter(
        (mappingEntry): mappingEntry is [string, string] =>
          (PAIRING_IMPORT_FIELDS as readonly string[]).includes(mappingEntry[0]) && typeof mappingEntry[1] === "string" && mappingEntry[1].trim() !== "",
      ),
    ),
  )
  .pipe(z.record(z.enum(PAIRING_IMPORT_FIELDS), columnLetterSchema));

/** Body of POST …/imports/preview. */
export const importPreviewInputSchema = z.object({
  uploadId: z.string().regex(/^[0-9a-f]{64}$/),
  roundNumber: z.number().int().positive(),
  sheetName: z.string().min(1).max(100),
  headerRowNumber: z.number().int().positive(),
  columnMapping: columnMappingSchema,
  excludedRowNumbers: z.array(z.number().int().positive()).max(10_000).default([]),
  playerChoices: z.record(z.string().regex(/^\d+:(WHITE|BLACK)$/), z.string().min(1)).default({}),
});

/** Body of POST …/imports/:uploadId/confirm. */
export const importConfirmInputSchema = importPreviewInputSchema.omit({ uploadId: true }).extend({
  originalFilename: z.string().min(1).max(255),
  isResultReplacementConfirmed: z.boolean().default(false),
});

/** Query of GET …/export: scope=all or round:n; include=official (default) or pending (reconciliation). */
export const exportQuerySchema = z.object({
  scope: z
    .string()
    .regex(/^(all|round:\d+)$/)
    .default("all")
    .transform((scopeText) => (scopeText === "all" ? null : Number(scopeText.slice("round:".length)))),
  include: z
    .enum(["official", "pending"])
    .default("official")
    .transform((includeText) => (includeText === "official" ? ("OFFICIAL" as const) : ("RECONCILIATION" as const))),
});
