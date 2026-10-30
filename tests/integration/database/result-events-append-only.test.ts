// tests/integration/database/result-events-append-only.test.ts
// Proves the database itself rejects UPDATE, DELETE and TRUNCATE on result_events (SRS-AUD-02, CLAUDE.md §2),
// so no code path can rewrite audit history even by mistake.

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/database/prisma-client";
import { wipeTestDatabase } from "../../helpers/test-database";

describe("result_events append-only trigger (SRS-AUD-02)", () => {
  let resultEventId: string;

  beforeEach(async () => {
    await wipeTestDatabase();
    const tournament = await prisma.tournament.create({
      data: { name: "Audit check", startDate: new Date(), endDate: new Date(), roundsCount: 1 },
    });
    const whitePlayer = await prisma.player.create({ data: { tournamentId: tournament.id, fullName: "Kỳ thủ Thử" } });
    const round = await prisma.round.create({ data: { tournamentId: tournament.id, roundNumber: 1 } });
    const game = await prisma.game.create({ data: { roundId: round.id, boardNumber: 1, whitePlayerId: whitePlayer.id } });
    const result = await prisma.result.create({ data: { gameId: game.id } });
    const resultEvent = await prisma.resultEvent.create({
      data: { resultId: result.id, action: "TEST_EVENT", newValue: { status: "NONE" } },
    });
    resultEventId = resultEvent.id;
  });

  it("allows inserts", async () => {
    expect(await prisma.resultEvent.count()).toBe(1);
  });

  it("rejects UPDATE", async () => {
    await expect(
      prisma.resultEvent.update({ where: { id: resultEventId }, data: { reason: "tampered" } }),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE", async () => {
    await expect(prisma.resultEvent.delete({ where: { id: resultEventId } })).rejects.toThrow(/append-only/);
  });

  it("rejects TRUNCATE", async () => {
    await expect(prisma.$executeRawUnsafe('TRUNCATE "result_events"')).rejects.toThrow(/append-only/);
    expect(await prisma.resultEvent.count()).toBe(1);
  });

  it("blocks deleting a result that has audit history", async () => {
    await expect(prisma.result.deleteMany()).rejects.toThrow();
    expect(await prisma.resultEvent.count()).toBe(1);
  });
});
