// src/components/tournament-navigation.tsx
// Tournament title and role-aware links to its rounds, console, settings and manual entry.
// Links are a convenience; every target page checks the role on the server (SRS-AUTH-06).

import Link from "next/link";
import { vi } from "@/i18n/vi";
import type { SignedInUser } from "@/server/auth/session-store";
import { hasPermission } from "@/server/auth/role-permissions";

/**
 * Tournament sub-navigation.
 *
 * @param props.signedInUser - Viewer, to decide which links to show.
 * @param props.tournamentId - Tournament ID.
 * @param props.tournamentName - Name shown as the heading.
 * @param props.roundNumbers - Rounds to link to.
 * @returns Heading plus a wrapping row of links.
 */
export function TournamentNavigation({
  signedInUser,
  tournamentId,
  tournamentName,
  roundNumbers,
}: {
  signedInUser: SignedInUser;
  tournamentId: string;
  tournamentName: string;
  roundNumbers: number[];
}) {
  const isTechnical = hasPermission(signedInUser.role, "MANAGE_TOURNAMENTS");
  const linkClassName = "rounded bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200 min-h-[44px] inline-flex items-center";
  return (
    <div className="mb-4">
      <h1 className="text-xl font-semibold">{tournamentName}</h1>
      <nav className="mt-2 flex flex-wrap gap-2">
        {roundNumbers.map((roundNumber) => (
          <Link key={roundNumber} href={`/tournaments/${tournamentId}/rounds/${roundNumber}`} className={linkClassName}>
            {vi.rounds.roundTitle(roundNumber)}
          </Link>
        ))}
        {isTechnical && (
          <>
            <Link href={`/tournaments/${tournamentId}/console`} className={linkClassName}>
              {vi.home.consoleLink}
            </Link>
            <Link href={`/tournaments/${tournamentId}/settings`} className={linkClassName}>
              {vi.home.settingsLink}
            </Link>
          </>
        )}
      </nav>
    </div>
  );
}
