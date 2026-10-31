// src/server/http/file-upload-route.ts
// Shared handling for multipart file uploads (logo, pairing workbook): same-origin check, session and role,
// a size gate before the body is read, the Idempotency-Key rule every mutation follows (SRS-SYNC-03), and error
// mapping. The idempotency hash covers the file bytes plus any extra form fields, not the multipart text,
// whose boundary changes on every retry.

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { vi } from "@/i18n/vi";
import type { SignedInUser } from "@/server/auth/session-store";
import type { Permission } from "@/server/auth/role-permissions";
import type { DatabaseClient } from "@/server/database/database-client";
import { ApiError } from "@/server/http/api-error";
import { assertSameOrigin, authorizeApiRequest, convertErrorToResponse, IDEMPOTENCY_KEY_HEADER } from "@/server/http/api-route-handler";
import { runIdempotentOperation, type StoredApiResponse } from "@/server/services/idempotency-service";

/** Multipart overhead allowed on top of the file limit before the request is rejected unread. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** What the upload callback receives. */
export interface UploadedFileContext {
  signedInUser: SignedInUser;
  fileBytes: Uint8Array;
  originalFilename: string;
  database: DatabaseClient;
}

/** Options for one upload endpoint. */
export interface FileUploadOptions {
  requiredPermission: Permission;
  /** Form field holding the file. */
  fileFieldName: string;
  maximumFileBytes: number;
  /** ApiError raised for an oversized body. */
  tooLargeError: ApiError;
  /** ApiError raised when the field is missing. */
  missingFileError: ApiError;
}

/**
 * Handles one multipart upload request.
 *
 * @param request - Incoming request.
 * @param options - Permission, field name, size limit and errors.
 * @param handleUpload - Business callback; runs inside the idempotent transaction.
 * @returns The JSON response (stored and replayed for a repeated Idempotency-Key).
 */
export async function handleFileUpload(
  request: NextRequest,
  options: FileUploadOptions,
  handleUpload: (uploadedFileContext: UploadedFileContext) => Promise<StoredApiResponse>,
): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const signedInUser = await authorizeApiRequest(request, options.requiredPermission);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > options.maximumFileBytes + MULTIPART_OVERHEAD_BYTES) throw options.tooLargeError;
    const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim();
    if (!idempotencyKey) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", vi.apiErrors.idempotencyKeyRequired);

    const formData = await request.formData();
    const uploadedFile = formData.get(options.fileFieldName);
    if (!(uploadedFile instanceof File)) throw options.missingFileError;
    if (uploadedFile.size > options.maximumFileBytes) throw options.tooLargeError;
    const fileBytes = new Uint8Array(await uploadedFile.arrayBuffer());
    const requestHash = createHash("sha256").update(`POST\n${request.nextUrl.pathname}\n${uploadedFile.name}\n`).update(fileBytes).digest("hex");

    const storedResponse = await runIdempotentOperation({ userId: signedInUser.id, idempotencyKey, requestHash }, (database) =>
      handleUpload({ signedInUser, fileBytes, originalFilename: uploadedFile.name, database }),
    );
    return NextResponse.json(storedResponse.body, { status: storedResponse.status });
  } catch (error) {
    return convertErrorToResponse(error);
  }
}
