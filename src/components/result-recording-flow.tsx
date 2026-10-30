// src/components/result-recording-flow.tsx
// Mobile result entry and two-player confirmation on the recorder's phone (AGENT_PROMPT.md §3.5, SRS-RES, SRS-CONF):
// choose a code → review → submit → White's step → Black's step → final status. Each step shows only that player's
// name and side, locks after one tap (SRS-CONF-05), and the flow resumes at the first unconfirmed side when the
// page is reopened (SRS-CONF-09). A stale version shows the server's 409 message with a reload button.

"use client";

import type { Role } from "@prisma/client";
import Link from "next/link";
import { useState } from "react";
import { vi } from "@/i18n/vi";
import { readApiErrorMessage, sendJsonMutation } from "@/client/api-request";
import { formatScoreLine } from "@/server/domain/result-display";
import type { PlayerSide } from "@/server/domain/result-state-machine";
import type { GameView, ResultCodeView } from "@/server/services/game-view-mapper";
import { ResultStatusBadge } from "@/components/result-status-badge";

/** Which screen the flow is on. */
type FlowScreen =
  | { kind: "CHOOSE" }
  | { kind: "REVIEW"; resultCode: ResultCodeView }
  | { kind: "CONFIRM_STEP"; side: PlayerSide; decision: "CONFIRM" | "REJECT" | null }
  | { kind: "FINAL" }
  | { kind: "NOT_SUBMITTABLE" };

/**
 * Decides the starting screen for a game (SRS-RES-05, SRS-CONF-09).
 *
 * @param game - Current game view.
 * @param viewerRole - Role of the arbiter holding the phone.
 * @returns The screen to show.
 */
export function findInitialFlowScreen(game: GameView, viewerRole: Role): FlowScreen {
  const { status, whiteConfirmedAt, blackConfirmedAt } = game.result;
  const isBye = game.black === null;
  if (status === "NONE" || status === "REOPENED") {
    // Byes take only TD codes (SRS-SM-04), so a recorder cannot enter them.
    return isBye && viewerRole !== "TECHNICAL" ? { kind: "NOT_SUBMITTABLE" } : { kind: "CHOOSE" };
  }
  if (status === "PENDING" && !isBye) {
    if (whiteConfirmedAt === null) return { kind: "CONFIRM_STEP", side: "WHITE", decision: null };
    if (blackConfirmedAt === null) return { kind: "CONFIRM_STEP", side: "BLACK", decision: null };
  }
  return { kind: "NOT_SUBMITTABLE" };
}

/**
 * Codes the viewer may pick for this game: byes only take codes without player confirmation; recorders only
 * get codes that players confirm (the others are TD-only, SRS-SM-04).
 *
 * @param resultCodes - Active codes of the tournament.
 * @param game - The game.
 * @param viewerRole - Viewer's role.
 * @returns Selectable codes in display order.
 */
export function selectAvailableResultCodes(resultCodes: ResultCodeView[], game: GameView, viewerRole: Role): ResultCodeView[] {
  const isBye = game.black === null;
  return resultCodes.filter((resultCode) => {
    if (!resultCode.isActive) return false;
    if (isBye) return !resultCode.requiresPlayerConfirmation && viewerRole === "TECHNICAL";
    return viewerRole === "TECHNICAL" || resultCode.requiresPlayerConfirmation;
  });
}

/**
 * Result recording flow.
 *
 * @param props.initialGame - Game as loaded by the server.
 * @param props.resultCodes - Active codes of the tournament.
 * @param props.viewerRole - Role of the signed-in arbiter.
 * @param props.roundListHref - Where "Về danh sách" goes.
 * @returns The current screen.
 */
export function ResultRecordingFlow({
  initialGame,
  resultCodes,
  viewerRole,
  roundListHref,
}: {
  initialGame: GameView;
  resultCodes: ResultCodeView[];
  viewerRole: Role;
  roundListHref: string;
}) {
  const [game, setGame] = useState(initialGame);
  const [screen, setScreen] = useState<FlowScreen>(() => findInitialFlowScreen(initialGame, viewerRole));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function postGameAction(actionPath: string, requestBody: Record<string, unknown>): Promise<GameView | null> {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await sendJsonMutation<{ game: GameView }>("POST", `/api/games/${game.gameId}/${actionPath}`, { ...requestBody, version: game.result.version });
      if (!result.isOk) {
        setErrorMessage(readApiErrorMessage(result.body, vi.common.error));
        return null;
      }
      setGame(result.body.game);
      return result.body.game;
    } catch {
      setErrorMessage(vi.apiErrors.serverError);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function reloadGame() {
    const response = await fetch(`/api/games/${game.gameId}`, { credentials: "same-origin" }).catch(() => null);
    if (!response?.ok) {
      setErrorMessage(vi.apiErrors.serverError);
      return;
    }
    const { game: reloadedGame } = (await response.json()) as { game: GameView };
    setGame(reloadedGame);
    setScreen(findInitialFlowScreen(reloadedGame, viewerRole));
    setErrorMessage(null);
  }

  async function submitChosenResult(resultCode: ResultCodeView) {
    const updatedGame = await postGameAction("result", { resultCodeId: resultCode.id });
    if (!updatedGame) return;
    setScreen(updatedGame.result.status === "PENDING" ? { kind: "CONFIRM_STEP", side: "WHITE", decision: null } : { kind: "FINAL" });
  }

  async function recordPlayerDecision(side: PlayerSide, decision: "CONFIRM" | "REJECT") {
    // SRS-CONF-05: lock the step on the first tap, before the network round trip.
    setScreen({ kind: "CONFIRM_STEP", side, decision });
    const updatedGame = await postGameAction("confirm", { side, decision });
    if (!updatedGame) {
      setScreen({ kind: "CONFIRM_STEP", side, decision: null });
      return;
    }
    if (decision === "REJECT" || updatedGame.result.status === "OFFICIAL") {
      setScreen({ kind: "FINAL" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="rounded-lg bg-white p-3 text-center">
        <p className="text-sm text-gray-600">{vi.record.roundAndBoard(game.roundNumber, game.boardNumber)}</p>
      </header>
      {screen.kind === "CHOOSE" && (
        <ChooseResultScreen
          resultCodes={selectAvailableResultCodes(resultCodes, game, viewerRole)}
          isBye={game.black === null}
          onChoose={(resultCode) => setScreen({ kind: "REVIEW", resultCode })}
        />
      )}
      {screen.kind === "REVIEW" && (
        <ReviewScreen
          game={game}
          resultCode={screen.resultCode}
          isSubmitting={isSubmitting}
          onSubmit={() => void submitChosenResult(screen.resultCode)}
          onEdit={() => setScreen({ kind: "CHOOSE" })}
        />
      )}
      {screen.kind === "CONFIRM_STEP" && (
        <ConfirmationStepScreen
          game={game}
          side={screen.side}
          decision={screen.decision}
          isSubmitting={isSubmitting}
          onDecide={(decision) => void recordPlayerDecision(screen.side, decision)}
          onContinueToBlack={() => setScreen({ kind: "CONFIRM_STEP", side: "BLACK", decision: null })}
        />
      )}
      {screen.kind === "FINAL" && <FinalScreen game={game} roundListHref={roundListHref} />}
      {screen.kind === "NOT_SUBMITTABLE" && <CurrentStateScreen game={game} roundListHref={roundListHref} />}
      {errorMessage && (
        <div role="alert" className="flex flex-col gap-2 rounded-md bg-red-50 p-3 text-red-800">
          <p>{errorMessage}</p>
          <button type="button" className="btn-secondary min-h-[48px]" onClick={() => void reloadGame()}>{vi.record.reload}</button>
        </div>
      )}
    </div>
  );
}

/**
 * Resolves the result code to show on a step: the one just chosen or the stored one.
 *
 * @param game - Current game.
 * @returns Label and score line, or null when no code is set.
 */
function describeStoredResult(game: GameView): { label: string; scoreLine: string } | null {
  const resultCode = game.result.resultCode;
  return resultCode ? { label: resultCode.labelVi, scoreLine: formatScoreLine(resultCode.whiteScore, resultCode.blackScore) } : null;
}

/** SRS-RES-02: large result buttons. */
function ChooseResultScreen({ resultCodes, isBye, onChoose }: { resultCodes: ResultCodeView[]; isBye: boolean; onChoose: (resultCode: ResultCodeView) => void }) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">{vi.record.chooseResult}</h1>
      {isBye && <p className="text-sm text-gray-600">{vi.record.byeNotice}</p>}
      {resultCodes.length === 0 && <p className="text-gray-600">{vi.record.noCodesAvailable}</p>}
      {resultCodes.map((resultCode) => (
        <button key={resultCode.id} type="button" onClick={() => onChoose(resultCode)} className="min-h-[56px] rounded-lg border-2 border-gray-300 bg-white px-4 text-left text-lg font-semibold hover:border-brand-primary">
          <span className="mr-3 inline-block min-w-[4rem]">{formatScoreLine(resultCode.whiteScore, resultCode.blackScore)}</span>
          {resultCode.labelVi}
        </button>
      ))}
    </section>
  );
}

/** SRS-RES-03: restate White, Black and the result in words and as a score before handing the phone over. */
function ReviewScreen({
  game,
  resultCode,
  isSubmitting,
  onSubmit,
  onEdit,
}: {
  game: GameView;
  resultCode: ResultCodeView;
  isSubmitting: boolean;
  onSubmit: () => void;
  onEdit: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{vi.record.reviewTitle}</h1>
      <div className="rounded-lg bg-white p-4 text-lg">
        <p><span className="text-gray-500">{vi.record.whiteLabel}: </span><strong>{game.white.fullName}</strong></p>
        <p><span className="text-gray-500">{vi.record.blackLabel}: </span><strong>{game.black?.fullName ?? vi.rounds.bye}</strong></p>
        <p className="mt-3 text-3xl font-bold" data-testid="review-score">{formatScoreLine(resultCode.whiteScore, resultCode.blackScore)}</p>
        <p className="text-2xl font-semibold">{resultCode.labelVi}</p>
      </div>
      <button type="button" disabled={isSubmitting} onClick={onSubmit} className="btn-confirm">
        {isSubmitting ? vi.record.submitting : resultCode.requiresPlayerConfirmation ? vi.record.submitToPlayers : vi.record.submitAsOfficial}
      </button>
      <button type="button" disabled={isSubmitting} onClick={onEdit} className="btn-secondary min-h-[56px] text-base">{vi.record.editChoice}</button>
    </section>
  );
}

/** SRS-CONF-02..05: one player's step — only their name and side, two big buttons, locked after one tap. */
function ConfirmationStepScreen({
  game,
  side,
  decision,
  isSubmitting,
  onDecide,
  onContinueToBlack,
}: {
  game: GameView;
  side: PlayerSide;
  decision: "CONFIRM" | "REJECT" | null;
  isSubmitting: boolean;
  onDecide: (decision: "CONFIRM" | "REJECT") => void;
  onContinueToBlack: () => void;
}) {
  const player = side === "WHITE" ? game.white : game.black;
  const sideLabel = side === "WHITE" ? vi.record.whiteLabel : vi.record.blackLabel;
  const storedResult = describeStoredResult(game);
  const isLocked = decision !== null;
  const isConfirmedByServer = side === "WHITE" ? game.result.whiteConfirmedAt !== null : game.result.blackConfirmedAt !== null;
  return (
    <section className="flex flex-col gap-4" data-testid={`confirmation-step-${side}`}>
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{vi.record.reminderCheckPlayer}</p>
      <div className="rounded-lg bg-white p-4 text-center">
        <p className="text-lg text-gray-600">{vi.record.stepTitle(sideLabel)}</p>
        <p className="text-3xl font-bold">{player?.fullName}</p>
        <p className="mt-1 inline-block rounded bg-gray-900 px-3 py-1 text-lg font-semibold text-white">{sideLabel}</p>
        {storedResult && (
          <>
            <p className="mt-4 text-4xl font-bold">{storedResult.scoreLine}</p>
            <p className="text-xl font-semibold">{storedResult.label}</p>
          </>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <button type="button" disabled={isLocked || isSubmitting} onClick={() => onDecide("CONFIRM")} className="btn-confirm">{vi.record.confirmButton}</button>
        <button type="button" disabled={isLocked || isSubmitting} onClick={() => onDecide("REJECT")} className="btn-reject">{vi.record.rejectButton}</button>
      </div>
      {decision === "CONFIRM" && isConfirmedByServer && (
        <div className="flex flex-col gap-3">
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-green-800">{vi.record.stepConfirmed}</p>
          {side === "WHITE" && game.result.status === "PENDING" && (
            <button type="button" onClick={onContinueToBlack} className="btn-primary min-h-[56px] text-base">{vi.record.continueToBlack}</button>
          )}
        </div>
      )}
    </section>
  );
}

/** SRS-CONF-08: the resulting status in words and a way back to the list. */
function FinalScreen({ game, roundListHref }: { game: GameView; roundListHref: string }) {
  const { status, isOfficialByDoubleConfirmation, approvedByUsername } = game.result;
  const explanation =
    status === "DISPUTED"
      ? vi.record.finalDisputed
      : status === "OFFICIAL" && isOfficialByDoubleConfirmation
        ? vi.record.finalOfficialByPlayers
        : status === "OFFICIAL" && approvedByUsername
          ? vi.record.finalOfficialByApproval
          : status === "OFFICIAL"
            ? vi.record.finalOfficialWithoutConfirmation
            : null;
  return (
    <section className="flex flex-col gap-4 rounded-lg bg-white p-4" data-testid="final-screen">
      <h1 className="text-xl font-semibold">{vi.record.finalTitle}</h1>
      <p className="text-2xl font-bold">{vi.record.finalStatus(vi.resultStatus[status])}</p>
      {explanation && <p className="text-lg">{explanation}</p>}
      <Link href={roundListHref} className="btn-primary inline-flex min-h-[56px] items-center justify-center text-base">{vi.record.backToList}</Link>
    </section>
  );
}

/** SRS-RES-05: a game that cannot be submitted shows its current state and who entered it. */
function CurrentStateScreen({ game, roundListHref }: { game: GameView; roundListHref: string }) {
  const storedResult = describeStoredResult(game);
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-white p-4">
      <p className="text-lg">{vi.record.currentState(vi.resultStatus[game.result.status])}</p>
      <ResultStatusBadge status={game.result.status} />
      <p className="text-base"><span className="text-gray-500">{vi.record.whiteLabel}: </span>{game.white.fullName}</p>
      <p className="text-base"><span className="text-gray-500">{vi.record.blackLabel}: </span>{game.black?.fullName ?? vi.rounds.bye}</p>
      {storedResult && <p className="text-2xl font-bold">{storedResult.scoreLine} · {storedResult.label}</p>}
      {game.result.enteredByUsername && <p className="text-sm text-gray-600">{vi.record.enteredBy(game.result.enteredByUsername)}</p>}
      {game.black === null && game.result.status === "NONE" && <p className="text-sm text-gray-600">{vi.record.byeNotice}</p>}
      <Link href={roundListHref} className="btn-primary inline-flex min-h-[56px] items-center justify-center text-base">{vi.record.backToList}</Link>
    </section>
  );
}
