// src/components/round-game-list.tsx
// Round pairing list for both roles (SRS-LOOK-01..04): search by board, name (diacritics ignored) or player ID,
// filter by status, and one tap per game to the record page, so a recorder reaches entry in ≤ 3 taps.
// Phone-first card layout. The page re-renders live through LiveRefresh; "Làm mới" forces a reload.

"use client";

import type { ResultStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { vi } from "@/i18n/vi";
import { doesGameMatchSearch } from "@/server/domain/game-search-filter";
import { formatScore, formatScoreLine } from "@/server/domain/result-display";
import type { GameView, PlayerView } from "@/server/services/game-view-mapper";
import { ResultStatusBadge } from "@/components/result-status-badge";

const STATUS_OPTIONS: ResultStatus[] = ["NONE", "PENDING", "DISPUTED", "OFFICIAL", "REOPENED"];

/**
 * Round game list with search and filter.
 *
 * @param props.games - All games of the round, by board.
 * @returns Search controls and the list.
 */
export function RoundGameList({ games }: { games: GameView[] }) {
  const router = useRouter();
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<ResultStatus | "">("");
  const visibleGames = games.filter((game) => doesGameMatchSearch(game, searchText, statusFilter || undefined));
  const controlClassName = "min-h-[44px] rounded-md border border-gray-300 px-3";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          aria-label={vi.rounds.searchLabel}
          placeholder={vi.rounds.searchPlaceholder}
          value={searchText}
          onChange={(changeEvent) => setSearchText(changeEvent.target.value)}
          className={`${controlClassName} min-w-0 flex-1`}
        />
        <select aria-label={vi.rounds.statusFilterLabel} value={statusFilter} onChange={(changeEvent) => setStatusFilter(changeEvent.target.value as ResultStatus | "")} className={controlClassName}>
          <option value="">{vi.rounds.statusFilterAll}</option>
          {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{vi.resultStatus[status]}</option>)}
        </select>
        <button type="button" onClick={() => router.refresh()} className="btn-secondary min-h-[44px]">{vi.rounds.refresh}</button>
      </div>
      {games.length === 0 && <p className="text-gray-600">{vi.rounds.noGames}</p>}
      {games.length > 0 && visibleGames.length === 0 && <p className="text-gray-600">{vi.rounds.noMatches}</p>}
      <ul className="flex flex-col gap-2">
        {visibleGames.map((game) => <GameCard key={game.gameId} game={game} />)}
      </ul>
    </div>
  );
}

/**
 * One game, tappable as a whole to open the record page.
 *
 * @param props.game - The game.
 * @returns A list item linking to /record/[gameId].
 */
function GameCard({ game }: { game: GameView }) {
  const resultCode = game.result.resultCode;
  const isPending = game.result.status === "PENDING";
  return (
    <li data-testid={`game-card-${game.boardNumber}`}>
      <Link href={`/record/${game.gameId}`} className="block rounded-lg border border-gray-200 bg-white p-3 hover:border-brand-primary">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-semibold">{vi.rounds.board} {game.boardNumber}</span>
          <span className="flex items-center gap-2">
            {resultCode && <span className="font-semibold">{formatScoreLine(resultCode.whiteScore, resultCode.blackScore)}</span>}
            <ResultStatusBadge status={game.result.status} />
          </span>
        </div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <PlayerLine sideLabel={vi.rounds.white} player={game.white} />
          {game.black ? <PlayerLine sideLabel={vi.rounds.black} player={game.black} /> : <p className="text-sm text-gray-600">{vi.rounds.bye}</p>}
        </div>
        {isPending && (
          <p className="mt-1 text-xs text-gray-600">
            {vi.rounds.confirmedSides(
              game.result.whiteConfirmedAt ? vi.rounds.confirmedMark : vi.rounds.unconfirmedMark,
              game.result.blackConfirmedAt ? vi.rounds.confirmedMark : vi.rounds.unconfirmedMark,
            )}
          </p>
        )}
      </Link>
    </li>
  );
}

/**
 * Player line: side, name, ID, club and provisional points.
 *
 * @param props.sideLabel - "Trắng" or "Đen".
 * @param props.player - The player.
 * @returns A paragraph.
 */
function PlayerLine({ sideLabel, player }: { sideLabel: string; player: PlayerView }) {
  const details = [
    player.swissManagerPlayerId ? vi.rounds.playerId(player.swissManagerPlayerId) : null,
    player.clubOrFederation,
    player.pointsBefore === null ? null : vi.rounds.provisionalPoints(formatScore(player.pointsBefore)),
  ].filter((detail): detail is string => detail !== null);
  return (
    <p className="text-sm">
      <span className="mr-1 inline-block w-10 text-gray-500">{sideLabel}</span>
      <span className="text-base font-medium">{player.fullName}</span>
      {details.length > 0 && <span className="block pl-11 text-xs text-gray-500">{details.join(" · ")}</span>}
    </p>
  );
}
