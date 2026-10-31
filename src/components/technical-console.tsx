// src/components/technical-console.tsx
// TD console (SRS-TD-01..05): status counts for a round, the oldest-first dispute queue showing who disagreed,
// the round's games, and a panel to approve / edit / reopen / cancel the selected result with a mandatory reason,
// plus the game's audit history. The page re-renders live through LiveRefresh; actions also refresh the data.

"use client";

import type { ResultStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { vi } from "@/i18n/vi";
import { readApiErrorMessage, sendJsonMutation } from "@/client/api-request";
import { formatInstantInTimezone } from "@/server/domain/date-time-format";
import { formatScoreLine } from "@/server/domain/result-display";
import type { GameHistoryEntry, ConsoleOverview } from "@/server/services/game-query-service";
import type { GameView, ResultCodeView } from "@/server/services/game-view-mapper";
import { FeedbackBanner, type FeedbackMessage } from "@/components/feedback-banner";
import { ResultStatusBadge } from "@/components/result-status-badge";

const STATUS_ORDER: ResultStatus[] = ["NONE", "PENDING", "DISPUTED", "OFFICIAL", "REOPENED"];

/** TD actions offered per status (SRS-SM-05..08); submitting is done on the record page. */
const ACTIONS_BY_STATUS: Record<ResultStatus, ("approve" | "edit" | "reopen" | "cancel")[]> = {
  NONE: [],
  PENDING: ["approve", "edit", "cancel"],
  DISPUTED: ["approve", "edit", "cancel"],
  OFFICIAL: ["reopen", "edit", "cancel"],
  REOPENED: ["edit", "cancel"],
};

/**
 * Formats a game's stored result for display.
 *
 * @param game - Game view.
 * @returns "1 – 0 · Trắng thắng" or the "no result" label.
 */
function describeResult(game: GameView): string {
  const resultCode = game.result.resultCode;
  return resultCode ? `${formatScoreLine(resultCode.whiteScore, resultCode.blackScore)} · ${resultCode.labelVi}` : vi.console.noCode;
}

/**
 * TD console.
 *
 * @param props.tournamentId - Tournament ID.
 * @param props.timezone - Tournament timezone for times (RULE-13).
 * @param props.roundNumbers - Rounds for the selector.
 * @param props.overview - Data for the selected round.
 * @returns The console layout.
 */
export function TechnicalConsole({
  tournamentId,
  timezone,
  roundNumbers,
  overview,
}: {
  tournamentId: string;
  timezone: string;
  roundNumbers: number[];
  overview: ConsoleOverview;
}) {
  const router = useRouter();
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const allGames = [...overview.disputedQueue, ...overview.games];
  const selectedGame = allGames.find((game) => game.gameId === selectedGameId) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <div className="flex flex-col gap-6">
        <label className="flex items-center gap-2 text-sm">
          {vi.console.roundLabel}
          <select
            aria-label={vi.console.roundLabel}
            value={overview.roundNumber}
            onChange={(changeEvent) => router.push(`/tournaments/${tournamentId}/console?round=${changeEvent.target.value}`)}
            className="min-h-[44px] rounded-md border border-gray-300 px-3"
          >
            {roundNumbers.map((roundNumber) => <option key={roundNumber} value={roundNumber}>{vi.rounds.roundTitle(roundNumber)}</option>)}
          </select>
          <button type="button" onClick={() => router.refresh()} className="btn-secondary min-h-[44px]">{vi.rounds.refresh}</button>
        </label>
        <section>
          <h2 className="mb-2 font-semibold">{vi.console.statusCountsHeading}</h2>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {STATUS_ORDER.map((status) => (
              <div key={status} className="rounded-lg border border-gray-200 bg-white p-3 text-center" data-testid={`status-count-${status}`}>
                <dt><ResultStatusBadge status={status} /></dt>
                <dd className="mt-1 text-2xl font-bold">{overview.statusCounts[status]}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">{vi.console.disputedQueueHeading}</h2>
          {overview.disputedQueue.length === 0 && <p className="text-sm text-gray-600">{vi.console.noDisputed}</p>}
          <ul className="flex flex-col gap-2">
            {overview.disputedQueue.map((game) => (
              <li key={game.gameId} data-testid={`disputed-${game.roundNumber}-${game.boardNumber}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                <div>
                  <p className="font-semibold">{vi.rounds.roundTitle(game.roundNumber)} · {vi.rounds.board} {game.boardNumber}: {game.white.fullName} – {game.black?.fullName ?? vi.rounds.bye}</p>
                  <p>{vi.console.currentCode(describeResult(game))}</p>
                  <p>
                    {game.result.disputedBySide && vi.console.disputedBy(game.result.disputedBySide === "WHITE" ? vi.rounds.white : vi.rounds.black)}
                    {game.result.disputedAt && ` · ${vi.console.disputedAt(formatInstantInTimezone(new Date(game.result.disputedAt), timezone))}`}
                  </p>
                </div>
                <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setSelectedGameId(game.gameId)}>{vi.console.selectGame}</button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">{vi.console.gamesHeading}</h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2">{vi.rounds.board}</th>
                  <th className="px-3 py-2">{vi.rounds.white}</th>
                  <th className="px-3 py-2">{vi.rounds.black}</th>
                  <th className="px-3 py-2">{vi.rounds.result}</th>
                  <th className="px-3 py-2">{vi.rounds.status}</th>
                  <th className="px-3 py-2">{vi.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {overview.games.map((game) => (
                  <tr key={game.gameId} className={`border-t border-gray-100 ${game.gameId === selectedGameId ? "bg-blue-50" : ""}`} data-testid={`console-game-${game.boardNumber}`}>
                    <td className="px-3 py-2 font-semibold">{game.boardNumber}</td>
                    <td className="px-3 py-2">{game.white.fullName}</td>
                    <td className="px-3 py-2">{game.black?.fullName ?? vi.rounds.bye}</td>
                    <td className="px-3 py-2">{game.result.resultCode ? formatScoreLine(game.result.resultCode.whiteScore, game.result.resultCode.blackScore) : ""}</td>
                    <td className="px-3 py-2"><ResultStatusBadge status={game.result.status} /></td>
                    <td className="px-3 py-2"><button type="button" className="btn-secondary min-h-[40px]" onClick={() => setSelectedGameId(game.gameId)}>{vi.console.selectGame}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {selectedGame && (
        <GameActionPanel key={`${selectedGame.gameId}-${selectedGame.result.version}`} game={selectedGame} resultCodes={overview.resultCodes} onChanged={() => router.refresh()} />
      )}
    </div>
  );
}

/**
 * Action and history panel for the selected game.
 *
 * @param props.game - Selected game (re-mounted when its version changes, so the form resets).
 * @param props.resultCodes - Tournament codes for approve/edit.
 * @param props.onChanged - Called after a successful action to reload page data.
 * @returns The side panel.
 */
function GameActionPanel({ game, resultCodes, onChanged }: { game: GameView; resultCodes: ResultCodeView[]; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [approveCodeId, setApproveCodeId] = useState("");
  const [editCodeId, setEditCodeId] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<GameHistoryEntry[] | null>(null);
  const activeCodes = resultCodes.filter((resultCode) => resultCode.isActive);
  const availableActions = ACTIONS_BY_STATUS[game.result.status];

  const loadHistory = useCallback(async () => {
    const response = await fetch(`/api/games/${game.gameId}/history`, { credentials: "same-origin" }).catch(() => null);
    if (response?.ok) {
      setHistory(((await response.json()) as { history: GameHistoryEntry[] }).history);
    }
  }, [game.gameId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function runAction(actionName: "approve" | "edit" | "reopen" | "cancel") {
    const requestBody: Record<string, unknown> = { reason, version: game.result.version };
    if (actionName === "approve") requestBody.resultCodeId = approveCodeId === "" ? null : approveCodeId;
    if (actionName === "edit") requestBody.resultCodeId = editCodeId;
    setIsSubmitting(true);
    const result = await sendJsonMutation("POST", `/api/games/${game.gameId}/${actionName}`, requestBody).catch(() => null);
    setIsSubmitting(false);
    if (!result || !result.isOk) {
      setFeedbackMessage({ isError: true, text: result ? readApiErrorMessage(result.body, vi.common.error) : vi.apiErrors.serverError });
      return;
    }
    setFeedbackMessage({ isError: false, text: vi.console.actionSuccess });
    onChanged();
  }

  const actionButtonLabels = {
    approve: vi.console.approveButton,
    edit: vi.console.editButton,
    reopen: vi.console.reopenButton,
    cancel: vi.console.cancelResultButton,
  };
  const selectClassName = "min-h-[44px] w-full rounded-md border border-gray-300 px-3";

  return (
    <aside className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4" data-testid="game-action-panel">
      <h2 className="font-semibold">{vi.console.actionsHeading(game.roundNumber, game.boardNumber)}</h2>
      <p className="text-sm">{game.white.fullName} – {game.black?.fullName ?? vi.rounds.bye}</p>
      <p className="text-sm">{vi.console.currentCode(describeResult(game))} <ResultStatusBadge status={game.result.status} /></p>
      {game.result.approvedByUsername && game.result.approvalReason && (
        <p className="text-sm text-gray-600">{vi.console.approvedBy(game.result.approvedByUsername, game.result.approvalReason)}</p>
      )}
      {(game.result.status === "NONE" || game.result.status === "REOPENED") && (
        <Link href={`/record/${game.gameId}`} className="btn-secondary inline-flex min-h-[44px] items-center">{vi.console.openRecordPage}</Link>
      )}
      {availableActions.length === 0 ? (
        <p className="text-sm text-gray-600">{vi.console.noActionsAvailable}</p>
      ) : (
        <>
          {availableActions.includes("approve") && (
            <label className="flex flex-col gap-1 text-sm">
              {vi.console.approveCodeLabel}
              <select value={approveCodeId} onChange={(changeEvent) => setApproveCodeId(changeEvent.target.value)} className={selectClassName}>
                <option value="">{vi.console.keepCurrentCode}</option>
                {activeCodes.map((resultCode) => <option key={resultCode.id} value={resultCode.id}>{resultCode.code} · {resultCode.labelVi}</option>)}
              </select>
            </label>
          )}
          {availableActions.includes("edit") && (
            <label className="flex flex-col gap-1 text-sm">
              {vi.console.newCodeLabel}
              <select value={editCodeId} onChange={(changeEvent) => setEditCodeId(changeEvent.target.value)} className={selectClassName}>
                <option value="">—</option>
                {activeCodes.map((resultCode) => <option key={resultCode.id} value={resultCode.id}>{resultCode.code} · {resultCode.labelVi}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {vi.console.reasonLabel}
            <textarea name="reason" value={reason} onChange={(changeEvent) => setReason(changeEvent.target.value)} rows={3} className="rounded-md border border-gray-300 p-2" />
          </label>
          <div className="flex flex-wrap gap-2">
            {availableActions.map((actionName) => (
              <button
                key={actionName}
                type="button"
                disabled={isSubmitting || (actionName === "edit" && editCodeId === "")}
                onClick={() => void runAction(actionName)}
                className={actionName === "approve" ? "btn-primary min-h-[44px]" : "btn-secondary min-h-[44px]"}
              >
                {actionButtonLabels[actionName]}
              </button>
            ))}
          </div>
        </>
      )}
      <FeedbackBanner feedbackMessage={feedbackMessage} />
      <section>
        <h3 className="mb-1 text-sm font-semibold">{vi.console.historyHeading}</h3>
        {history !== null && history.length === 0 && <p className="text-sm text-gray-600">{vi.console.noHistory}</p>}
        <ol className="flex flex-col gap-2 text-xs" data-testid="game-history">
          {history?.map((historyEntry) => (
            <li key={historyEntry.id} className="rounded border border-gray-100 p-2">
              <p className="font-medium">
                {vi.console.historyLine(historyEntry.createdAtText, historyEntry.actorUsername ?? "—", vi.console.eventActions[historyEntry.action] ?? historyEntry.action)}
              </p>
              <p className="text-gray-600">
                {vi.console.historyChange(describeSnapshot(historyEntry.oldValue), describeSnapshot(historyEntry.newValue))}
              </p>
              {historyEntry.reason && <p>{vi.console.historyReason(historyEntry.reason)}</p>}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

/**
 * Short text for an audit snapshot: status label plus code.
 *
 * @param snapshot - old_value / new_value JSON.
 * @returns e.g. "Chờ xác nhận (1-0)".
 */
function describeSnapshot(snapshot: unknown): string {
  const { status, resultCode } = (snapshot ?? {}) as { status?: ResultStatus; resultCode?: string | null };
  const statusLabel = status ? vi.resultStatus[status] : "—";
  return resultCode ? `${statusLabel} (${resultCode})` : statusLabel;
}
