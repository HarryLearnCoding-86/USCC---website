// src/server/domain/tournament-logo-url.ts
// Builds the URL of a tournament's logo (SRS-TOUR-02). The storage key changes on every upload, so it doubles as a
// cache-busting version: a new logo shows at once, an unchanged one stays cached. Pure; shared by client and server.

/**
 * Logo URL for a tournament.
 *
 * @param tournamentId - Tournament ID.
 * @param logoStorageKey - Stored logo key, or null when no logo was uploaded.
 * @returns The authenticated logo route with a version parameter, or null when there is no logo.
 */
export function buildTournamentLogoUrl(tournamentId: string, logoStorageKey: string | null): string | null {
  return logoStorageKey ? `/api/tournaments/${tournamentId}/logo?v=${encodeURIComponent(logoStorageKey)}` : null;
}
