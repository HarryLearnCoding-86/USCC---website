// src/app/api/tournaments/[tournamentId]/imports/route.ts
// POST /api/tournaments/:id/imports — step 1 of the import wizard: upload one .xlsx (≤ 5 MB) as multipart field
// "workbook" and get back its sheets and the saved mapping (SRS-IMP-01, 02, 04). Nothing is written to pairing data.
// TECHNICAL only; honours Idempotency-Key.

import type { NextRequest } from "next/server";
import { vi } from "@/i18n/vi";
import { ApiError } from "@/server/http/api-error";
import { handleFileUpload } from "@/server/http/file-upload-route";
import { toJsonBody } from "@/server/http/json-body";
import { MAXIMUM_IMPORT_FILE_BYTES, storeUploadedWorkbook } from "@/server/services/pairing-import-service";

export const runtime = "nodejs";

/**
 * Stores the workbook and returns its outline.
 *
 * @returns 201 { uploadId, originalFilename, outline, savedMapping }; 400 IMPORT_NOT_XLSX / IMPORT_FILE_UNREADABLE;
 *   413 IMPORT_FILE_TOO_LARGE; 401/403/404.
 */
export async function POST(request: NextRequest, routeContext: { params: Promise<{ tournamentId: string }> }): Promise<Response> {
  const { tournamentId } = await routeContext.params;
  return handleFileUpload(
    request,
    {
      requiredPermission: "IMPORT_PAIRINGS",
      fileFieldName: "workbook",
      maximumFileBytes: MAXIMUM_IMPORT_FILE_BYTES,
      tooLargeError: new ApiError(413, "IMPORT_FILE_TOO_LARGE", vi.importExport.fileTooLarge),
      missingFileError: new ApiError(400, "IMPORT_NOT_XLSX", vi.importExport.notXlsx),
    },
    async ({ fileBytes, originalFilename, database }) => {
      const uploadedWorkbook = await storeUploadedWorkbook(tournamentId, fileBytes, database);
      return { status: 201, body: toJsonBody({ ...uploadedWorkbook, originalFilename }) };
    },
  );
}
