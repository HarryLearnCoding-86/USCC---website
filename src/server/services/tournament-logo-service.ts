// src/server/services/tournament-logo-service.ts
// Tournament logo upload and download (SRS-TOUR-02). The format is detected from the bytes; the stored key is
// derived from the tournament ID and the file hash, never from the uploaded file name. Replacing a logo deletes
// the previous file after the database points at the new one.

import { createHash } from "node:crypto";
import { vi } from "@/i18n/vi";
import type { DatabaseClient } from "@/server/database/database-client";
import { prisma } from "@/server/database/prisma-client";
import { detectLogoFileType, LOGO_CONTENT_TYPES, MAXIMUM_LOGO_BYTES, type LogoFileType } from "@/server/domain/logo-file-rules";
import { ApiError } from "@/server/http/api-error";
import { notifyTournamentChanged } from "@/server/services/change-notifier";
import { getFileStorage, type FileStorage } from "@/server/storage/file-storage";

const FILE_EXTENSIONS: Record<LogoFileType, string> = { png: "png", jpeg: "jpg", svg: "svg" };

/** A logo ready to send to the browser. */
export interface StoredLogo {
  fileBytes: Uint8Array;
  contentType: string;
  /** Changes whenever the logo changes, so the browser can cache by key. */
  storageKey: string;
}

/**
 * Validates and stores a tournament logo, replacing any previous one.
 *
 * @param tournamentId - Tournament ID.
 * @param fileBytes - Uploaded content.
 * @param database - Transaction client of the request.
 * @param fileStorage - Storage backend (injectable for tests).
 * @returns The new storage key.
 * @throws ApiError 404 TOURNAMENT_NOT_FOUND, 413 LOGO_TOO_LARGE, 400 LOGO_INVALID_TYPE.
 */
export async function uploadTournamentLogo(
  tournamentId: string,
  fileBytes: Uint8Array,
  database: DatabaseClient,
  fileStorage: FileStorage = getFileStorage(),
): Promise<{ storageKey: string }> {
  const tournament = await database.tournament.findUnique({ where: { id: tournamentId }, select: { logoStorageKey: true } });
  if (!tournament) {
    throw new ApiError(404, "TOURNAMENT_NOT_FOUND", vi.tournaments.tournamentNotFound);
  }
  if (fileBytes.byteLength > MAXIMUM_LOGO_BYTES) {
    throw new ApiError(413, "LOGO_TOO_LARGE", vi.logo.tooLarge);
  }
  const logoFileType = detectLogoFileType(fileBytes);
  if (!logoFileType) {
    throw new ApiError(400, "LOGO_INVALID_TYPE", vi.logo.invalidType);
  }
  const contentHash = createHash("sha256").update(fileBytes).digest("hex").slice(0, 16);
  const storageKey = `tournaments/${tournamentId}/logo-${contentHash}.${FILE_EXTENSIONS[logoFileType]}`;
  await fileStorage.saveFile(storageKey, fileBytes);
  await database.tournament.update({ where: { id: tournamentId }, data: { logoStorageKey: storageKey } });
  await notifyTournamentChanged({ tournamentId }, database);
  if (tournament.logoStorageKey && tournament.logoStorageKey !== storageKey) {
    await fileStorage.deleteFile(tournament.logoStorageKey).catch(() => undefined);
  }
  return { storageKey };
}

/**
 * Loads a tournament's logo.
 *
 * @param tournamentId - Tournament ID.
 * @param fileStorage - Storage backend (injectable for tests).
 * @returns The logo, or null when none is set or the file is missing.
 */
export async function readTournamentLogo(tournamentId: string, fileStorage: FileStorage = getFileStorage()): Promise<StoredLogo | null> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { logoStorageKey: true } });
  if (!tournament?.logoStorageKey) {
    return null;
  }
  const fileBytes = await fileStorage.readFile(tournament.logoStorageKey);
  const logoFileType = fileBytes ? detectLogoFileType(fileBytes) : null;
  if (!fileBytes || !logoFileType) {
    return null;
  }
  return { fileBytes, contentType: LOGO_CONTENT_TYPES[logoFileType], storageKey: tournament.logoStorageKey };
}
