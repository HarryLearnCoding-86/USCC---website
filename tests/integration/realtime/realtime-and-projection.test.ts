// tests/integration/realtime/realtime-and-projection.test.ts
// Integration tests for Phase 3 against PostgreSQL:
//   - a committed result transition reaches an open SSE stream through LISTEN/NOTIFY; a rolled-back one does not;
//   - the projection view carries results only for OFFICIAL games (FR-06) and shows byes without an opponent;
//   - logo upload validates content and size and stores the file (SRS-TOUR-02).

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "@/server/database/prisma-client";
import { ApiError } from "@/server/http/api-error";
import { stopPostgresChangeListener } from "@/server/realtime/postgres-change-listener";
import { openTournamentEventStream } from "@/server/realtime/server-sent-events";
import { getProjectionView } from "@/server/services/projection-service";
import { applyResultTransition, type ResultActionRequest } from "@/server/services/result-lifecycle-service";
import { readTournamentLogo, uploadTournamentLogo } from "@/server/services/tournament-logo-service";
import { LocalDiskFileStorage } from "@/server/storage/file-storage";
import { createFixtureUser, wipeTestDatabase } from "../../helpers/test-database";
import { createTournamentFixture, type TournamentFixture } from "../../helpers/tournament-fixtures";

/**
 * Reads SSE chunks from a stream until a predicate matches or the timeout passes.
 *
 * @param streamReader - Reader of the response body.
 * @param isWanted - Returns true for the text that ends the wait.
 * @param timeoutMilliseconds - Maximum wait.
 * @returns All text received.
 */
async function readStreamUntil(
  streamReader: ReadableStreamDefaultReader<Uint8Array>,
  isWanted: (receivedText: string) => boolean,
  timeoutMilliseconds: number,
): Promise<string> {
  const textDecoder = new TextDecoder();
  let receivedText = "";
  const deadline = Date.now() + timeoutMilliseconds;
  while (!isWanted(receivedText) && Date.now() < deadline) {
    const nextChunk = await Promise.race([
      streamReader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(1, deadline - Date.now()))),
    ]);
    if (!nextChunk || nextChunk.done) break;
    receivedText += textDecoder.decode(nextChunk.value);
  }
  return receivedText;
}

describe("Phase 3 realtime, projection and logo", () => {
  let fixture: TournamentFixture;
  let recorderUser: { id: string; username: string; role: Role };
  let technicalUser: { id: string; username: string; role: Role };

  beforeEach(async () => {
    await wipeTestDatabase();
    recorderUser = await createFixtureUser("recorder_realtime", "RECORDER");
    technicalUser = await createFixtureUser("td_realtime", "TECHNICAL");
    fixture = await createTournamentFixture();
  });

  afterAll(async () => {
    await stopPostgresChangeListener();
  });

  /**
   * Applies an action in its own transaction.
   *
   * @param gameId - Game.
   * @param expectedVersion - Version.
   * @param actionRequest - Action.
   * @param actor - User.
   * @returns Updated game view.
   */
  function act(gameId: string, expectedVersion: number, actionRequest: ResultActionRequest, actor = recorderUser) {
    return prisma.$transaction((transaction) => applyResultTransition({ gameId, expectedVersion, actionRequest, actor }, transaction));
  }

  it("delivers a committed result change to an open SSE stream, and never a rolled-back one", async () => {
    const abortController = new AbortController();
    const streamResponse = await openTournamentEventStream({
      tournamentId: fixture.tournamentId,
      abortSignal: abortController.signal,
      isSessionStillValid: async () => true,
    });
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
    const streamReader = (streamResponse.body as ReadableStream<Uint8Array>).getReader();
    expect(await readStreamUntil(streamReader, (receivedText) => receivedText.includes("event: ready"), 3000)).toContain("event: ready");

    // A transition whose transaction rolls back must not notify.
    await prisma
      .$transaction(async (transaction) => {
        await applyResultTransition(
          { gameId: fixture.twoPlayerGame.gameId, expectedVersion: 0, actionRequest: { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["1-0"] as string }, actor: recorderUser },
          transaction,
        );
        throw new Error("forced rollback");
      })
      .catch(() => undefined);

    await act(fixture.twoPlayerGame.gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["0-1"] as string });
    const receivedText = await readStreamUntil(streamReader, (text) => text.includes("event: result_changed"), 5000);
    const resultEvents = receivedText.split("\n\n").filter((message) => message.startsWith("event: result_changed"));
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0]).toContain(`"gameId":"${fixture.twoPlayerGame.gameId}"`);
    expect(resultEvents[0]).toContain('"version":1');
    abortController.abort();
  });

  it("closes the stream when the session is no longer valid (SRS-AUTH-07)", async () => {
    let isSessionValid = true;
    const streamResponse = await openTournamentEventStream({
      tournamentId: fixture.tournamentId,
      abortSignal: new AbortController().signal,
      isSessionStillValid: async () => isSessionValid,
      heartbeatIntervalMilliseconds: 100,
    });
    const streamReader = (streamResponse.body as ReadableStream<Uint8Array>).getReader();
    expect(await readStreamUntil(streamReader, (receivedText) => receivedText.includes("event: heartbeat"), 2000)).toContain("event: heartbeat");
    isSessionValid = false;
    let isDone = false;
    const deadline = Date.now() + 2000;
    while (!isDone && Date.now() < deadline) {
      isDone = (await streamReader.read()).done;
    }
    expect(isDone).toBe(true);
  });

  it("projects only OFFICIAL results and shows a bye without an opponent (FR-06, SRS-PROJ-02, 08)", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    await act(gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["1-0"] as string });
    await act(gameId, 1, { type: "CONFIRM_BY_SIDE", side: "WHITE" });
    let projection = await getProjectionView(fixture.tournamentId, 1);
    expect(projection.games.find((game) => game.boardNumber === 1)?.officialResult).toBeNull();

    await act(gameId, 2, { type: "REJECT_BY_SIDE", side: "BLACK" });
    projection = await getProjectionView(fixture.tournamentId, 1);
    expect(projection.games.find((game) => game.boardNumber === 1)?.officialResult).toBeNull();

    await act(gameId, 3, { type: "APPROVE_EXCEPTION", resultCodeId: null, reason: "Đã kiểm tra biên bản" }, technicalUser);
    await act(fixture.byeGame.gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode.BYE as string }, technicalUser);
    projection = await getProjectionView(fixture.tournamentId, null);
    expect(projection.roundNumber).toBe(1);
    expect(projection.games).toEqual([
      expect.objectContaining({ boardNumber: 1, officialResult: { scoreLine: "1 – 0", labelVi: "Trắng thắng", isWithoutPlayerConfirmation: false } }),
      expect.objectContaining({ boardNumber: 2, blackName: null, officialResult: expect.objectContaining({ isWithoutPlayerConfirmation: true }) }),
    ]);
    expect(projection.hasProvisionalPoints).toBe(true);
  });

  it("stores a valid logo, rejects disguised or oversized files (SRS-TOUR-02)", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "uscc-logo-"));
    const fileStorage = new LocalDiskFileStorage(temporaryDirectory);
    try {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      const { storageKey } = await prisma.$transaction((transaction) => uploadTournamentLogo(fixture.tournamentId, pngBytes, transaction, fileStorage));
      expect(storageKey).toMatch(new RegExp(`^tournaments/${fixture.tournamentId}/logo-[0-9a-f]{16}\\.png$`));
      expect(await readTournamentLogo(fixture.tournamentId, fileStorage)).toMatchObject({ contentType: "image/png", storageKey });

      const disguisedHtml = new TextEncoder().encode("<html><script>alert(1)</script></html>");
      const typeError = await prisma.$transaction((transaction) => uploadTournamentLogo(fixture.tournamentId, disguisedHtml, transaction, fileStorage)).catch((caughtError: unknown) => caughtError);
      expect(typeError).toBeInstanceOf(ApiError);
      expect(typeError).toMatchObject({ httpStatus: 400, code: "LOGO_INVALID_TYPE" });

      const oversizedBytes = new Uint8Array(2 * 1024 * 1024 + 1);
      oversizedBytes.set(pngBytes);
      const sizeError = await prisma.$transaction((transaction) => uploadTournamentLogo(fixture.tournamentId, oversizedBytes, transaction, fileStorage)).catch((caughtError: unknown) => caughtError);
      expect(sizeError).toMatchObject({ httpStatus: 413, code: "LOGO_TOO_LARGE" });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("refuses storage keys that escape the upload directory", async () => {
    const fileStorage = new LocalDiskFileStorage(os.tmpdir());
    await expect(fileStorage.saveFile("../outside.txt", new Uint8Array([1]))).rejects.toThrow(/escapes/);
  });
});
