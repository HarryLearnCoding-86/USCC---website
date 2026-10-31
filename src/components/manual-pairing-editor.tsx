// src/components/manual-pairing-editor.tsx
// TD manual pairing entry for one round (SRS-IMP-13): list of boards with edit / delete, and a form for a new
// or edited board. Validation (duplicate boards, players on two boards, ID/name conflicts) happens on the
// server; this form shows the first problem the server reports.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { vi } from "@/i18n/vi";
import { readApiErrorMessage, sendJsonMutation } from "@/client/api-request";
import { formatScore } from "@/server/domain/result-display";
import type { GameView, PlayerView } from "@/server/services/game-view-mapper";
import { FeedbackBanner, type FeedbackMessage } from "@/components/feedback-banner";
import { ResultStatusBadge } from "@/components/result-status-badge";

/** One side of the form; points as text so the field can be empty. */
interface PairingSideDraft {
  swissManagerPlayerId: string;
  fullName: string;
  clubOrFederation: string;
  pointsBefore: string;
}

/** The whole board form. */
interface PairingDraft {
  boardNumber: string;
  white: PairingSideDraft;
  black: PairingSideDraft;
}

const EMPTY_SIDE_DRAFT: PairingSideDraft = { swissManagerPlayerId: "", fullName: "", clubOrFederation: "", pointsBefore: "" };

/**
 * Converts a player view to form text.
 *
 * @param player - Player, or null for an empty Black side (bye).
 * @returns Draft values.
 */
function toSideDraft(player: PlayerView | null): PairingSideDraft {
  if (!player) return EMPTY_SIDE_DRAFT;
  return {
    swissManagerPlayerId: player.swissManagerPlayerId ?? "",
    fullName: player.fullName,
    clubOrFederation: player.clubOrFederation ?? "",
    pointsBefore: player.pointsBefore === null ? "" : String(player.pointsBefore),
  };
}

/**
 * Manual pairing editor.
 *
 * @param props.tournamentId - Tournament ID.
 * @param props.roundNumber - Round number.
 * @param props.games - Current boards of the round.
 * @returns Board list and form.
 */
export function ManualPairingEditor({ tournamentId, roundNumber, games }: { tournamentId: string; roundNumber: number; games: GameView[] }) {
  const router = useRouter();
  const nextBoardNumber = games.reduce((highestBoard, game) => Math.max(highestBoard, game.boardNumber), 0) + 1;
  const emptyDraft: PairingDraft = { boardNumber: String(nextBoardNumber), white: EMPTY_SIDE_DRAFT, black: EMPTY_SIDE_DRAFT };
  const [draft, setDraft] = useState<PairingDraft>(emptyDraft);
  const [editingBoardNumber, setEditingBoardNumber] = useState<number | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const roundPath = `/api/tournaments/${tournamentId}/rounds/${roundNumber}/games`;

  function startEditing(game: GameView) {
    setEditingBoardNumber(game.boardNumber);
    setDraft({ boardNumber: String(game.boardNumber), white: toSideDraft(game.white), black: toSideDraft(game.black) });
    setFeedbackMessage(null);
  }

  function resetForm(nextBoard: number) {
    setEditingBoardNumber(null);
    setDraft({ ...emptyDraft, boardNumber: String(nextBoard) });
  }

  async function submitBoard(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setIsSubmitting(true);
    const isEditing = editingBoardNumber !== null;
    const result = await sendJsonMutation(isEditing ? "PUT" : "POST", isEditing ? `${roundPath}/${editingBoardNumber}` : roundPath, draft).catch(() => null);
    setIsSubmitting(false);
    if (!result || !result.isOk) {
      setFeedbackMessage({ isError: true, text: result ? readApiErrorMessage(result.body, vi.common.error) : vi.apiErrors.serverError });
      return;
    }
    setFeedbackMessage({ isError: false, text: vi.manualPairing.saved });
    resetForm(Math.max(nextBoardNumber, Number(draft.boardNumber) + 1));
    router.refresh();
  }

  async function deleteBoard(boardNumber: number) {
    if (!window.confirm(vi.manualPairing.deleteConfirm(boardNumber))) return;
    const result = await sendJsonMutation("DELETE", `${roundPath}/${boardNumber}`).catch(() => null);
    if (!result || !result.isOk) {
      setFeedbackMessage({ isError: true, text: result ? readApiErrorMessage(result.body, vi.common.error) : vi.apiErrors.serverError });
      return;
    }
    setFeedbackMessage({ isError: false, text: vi.manualPairing.deleted });
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ul className="flex flex-col gap-2">
        {games.map((game) => (
          <li key={game.gameId} data-testid={`manual-board-${game.boardNumber}`} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <div>
              <p className="font-semibold">{vi.rounds.board} {game.boardNumber} <ResultStatusBadge status={game.result.status} /></p>
              <p>{game.white.fullName} — {game.black ? game.black.fullName : vi.rounds.bye}</p>
            </div>
            <div className="flex gap-1">
              <button type="button" className="btn-secondary min-h-[44px]" onClick={() => startEditing(game)}>{vi.manualPairing.editBoard}</button>
              <button type="button" className="btn-secondary min-h-[44px]" onClick={() => void deleteBoard(game.boardNumber)}>{vi.manualPairing.deleteBoard}</button>
            </div>
          </li>
        ))}
        {games.length === 0 && <li className="text-gray-600">{vi.rounds.noGames}</li>}
      </ul>
      <form onSubmit={submitBoard} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold">{editingBoardNumber === null ? vi.manualPairing.newBoardHeading : vi.manualPairing.editBoardHeading(editingBoardNumber)}</h2>
        <label className="flex flex-col gap-1 text-sm">
          {vi.manualPairing.boardNumberLabel}
          <input name="boardNumber" type="number" min={1} value={draft.boardNumber} onChange={(changeEvent) => setDraft({ ...draft, boardNumber: changeEvent.target.value })} className="min-h-[44px] w-28 rounded-md border border-gray-300 px-3" required />
        </label>
        <PairingSideFields sideKey="white" heading={vi.manualPairing.whiteSection} sideDraft={draft.white} onChange={(sideDraft) => setDraft({ ...draft, white: sideDraft })} />
        <PairingSideFields sideKey="black" heading={vi.manualPairing.blackSection} sideDraft={draft.black} onChange={(sideDraft) => setDraft({ ...draft, black: sideDraft })} />
        <FeedbackBanner feedbackMessage={feedbackMessage} />
        <div className="flex gap-2">
          <button type="submit" disabled={isSubmitting} className="btn-primary min-h-[44px]">{vi.manualPairing.saveBoard}</button>
          {editingBoardNumber !== null && <button type="button" className="btn-secondary min-h-[44px]" onClick={() => resetForm(nextBoardNumber)}>{vi.manualPairing.cancelEdit}</button>}
        </div>
      </form>
    </div>
  );
}

/**
 * Inputs for one side.
 *
 * @param props.sideKey - "white" or "black", used for input names.
 * @param props.heading - Section heading.
 * @param props.sideDraft - Current values.
 * @param props.onChange - Receives the updated side.
 * @returns A fieldset.
 */
function PairingSideFields({
  sideKey,
  heading,
  sideDraft,
  onChange,
}: {
  sideKey: "white" | "black";
  heading: string;
  sideDraft: PairingSideDraft;
  onChange: (sideDraft: PairingSideDraft) => void;
}) {
  const inputClassName = "min-h-[44px] rounded-md border border-gray-300 px-3";
  const fields: { fieldName: keyof PairingSideDraft; label: string; inputMode?: "decimal" }[] = [
    { fieldName: "swissManagerPlayerId", label: vi.manualPairing.playerIdLabel },
    { fieldName: "fullName", label: vi.manualPairing.fullNameLabel },
    { fieldName: "clubOrFederation", label: vi.manualPairing.clubLabel },
    { fieldName: "pointsBefore", label: vi.manualPairing.pointsLabel, inputMode: "decimal" },
  ];
  return (
    <fieldset className="grid gap-2 rounded-md border border-gray-200 p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold">{heading}</legend>
      {fields.map(({ fieldName, label, inputMode }) => (
        <label key={fieldName} className="flex flex-col gap-1 text-sm">
          {label}
          <input
            name={`${sideKey}-${fieldName}`}
            value={sideDraft[fieldName]}
            inputMode={inputMode}
            placeholder={fieldName === "pointsBefore" ? formatScore(0.5) : undefined}
            onChange={(changeEvent) => onChange({ ...sideDraft, [fieldName]: changeEvent.target.value })}
            className={inputClassName}
          />
        </label>
      ))}
    </fieldset>
  );
}
