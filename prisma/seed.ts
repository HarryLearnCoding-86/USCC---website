// prisma/seed.ts
// Demo data for local development: one TD, one recorder, one demo tournament with
// 2 rounds × 10 boards, 20 fictional players and the default result codes (AGENT_PROMPT.md Phase 1).
// Idempotent: upserts by natural keys, so it is safe to run repeatedly.
// Player names are invented; no real personal data is used (CLAUDE.md §2).

import { PrismaClient, Role, RoundStatus, ResultStatus } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password-hasher";
import { DEFAULT_RESULT_CODES } from "../src/server/domain/default-result-codes";

const DEMO_TOURNAMENT_ID = "demo-tournament-001";
const ROUNDS_COUNT = 2;
const BOARDS_PER_ROUND = 10;

/** Fictional demo players. IDs mimic Swiss-Manager starting numbers. */
const DEMO_PLAYERS = [
  { swissManagerPlayerId: "1001", fullName: "Nguyễn Văn An", clubOrFederation: "CLB Demo A", rating: 1800 },
  { swissManagerPlayerId: "1002", fullName: "Trần Thị Bình", clubOrFederation: "CLB Demo B", rating: 1750 },
  { swissManagerPlayerId: "1003", fullName: "Lê Văn Cường", clubOrFederation: "CLB Demo A", rating: 1700 },
  { swissManagerPlayerId: "1004", fullName: "Phạm Thị Dung", clubOrFederation: "CLB Demo C", rating: 1680 },
  { swissManagerPlayerId: "1005", fullName: "Hoàng Văn Em", clubOrFederation: "CLB Demo B", rating: 1660 },
  { swissManagerPlayerId: "1006", fullName: "Đặng Thị Phương", clubOrFederation: "CLB Demo C", rating: 1640 },
  { swissManagerPlayerId: "1007", fullName: "Vũ Văn Giang", clubOrFederation: "CLB Demo A", rating: 1620 },
  { swissManagerPlayerId: "1008", fullName: "Bùi Thị Hạnh", clubOrFederation: "CLB Demo B", rating: 1600 },
  { swissManagerPlayerId: "1009", fullName: "Ngô Văn Inh", clubOrFederation: "CLB Demo C", rating: 1580 },
  { swissManagerPlayerId: "1010", fullName: "Đỗ Thị Kim", clubOrFederation: "CLB Demo A", rating: 1560 },
  { swissManagerPlayerId: "1011", fullName: "Dương Văn Long", clubOrFederation: "CLB Demo B", rating: 1540 },
  { swissManagerPlayerId: "1012", fullName: "Phan Thị Mai", clubOrFederation: "CLB Demo C", rating: 1520 },
  { swissManagerPlayerId: "1013", fullName: "Đinh Văn Nam", clubOrFederation: "CLB Demo A", rating: 1500 },
  { swissManagerPlayerId: "1014", fullName: "Lý Thị Oanh", clubOrFederation: "CLB Demo B", rating: 1480 },
  { swissManagerPlayerId: "1015", fullName: "Mai Văn Phúc", clubOrFederation: "CLB Demo C", rating: 1460 },
  { swissManagerPlayerId: "1016", fullName: "Võ Thị Quỳnh", clubOrFederation: "CLB Demo A", rating: 1440 },
  { swissManagerPlayerId: "1017", fullName: "Cao Văn Sơn", clubOrFederation: "CLB Demo B", rating: 1420 },
  { swissManagerPlayerId: "1018", fullName: "Trương Thị Thu", clubOrFederation: "CLB Demo C", rating: 1400 },
  { swissManagerPlayerId: "1019", fullName: "Hà Văn Uy", clubOrFederation: "CLB Demo A", rating: 1380 },
  { swissManagerPlayerId: "1020", fullName: "Lưu Thị Vân", clubOrFederation: "CLB Demo B", rating: 1360 },
] as const;

const prisma = new PrismaClient();

/**
 * Creates or refreshes a demo arbiter account.
 * Credentials come from SEED_* env vars so nobody has to edit code to change them;
 * the defaults are documented demo values for local development only.
 *
 * @param username - Login name.
 * @param plainPassword - Password to hash with argon2id.
 * @param role - TECHNICAL or RECORDER.
 * @returns The upserted user.
 */
async function upsertDemoUser(username: string, plainPassword: string, role: Role) {
  const passwordHash = await hashPassword(plainPassword);
  return prisma.user.upsert({
    where: { username },
    update: { passwordHash, role, isActive: true },
    create: { username, passwordHash, role, isActive: true },
  });
}

/**
 * Creates the demo tournament and its default result codes.
 *
 * @returns The tournament row.
 */
async function upsertDemoTournament() {
  const today = new Date();
  const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

  const tournament = await prisma.tournament.upsert({
    where: { id: DEMO_TOURNAMENT_ID },
    update: { roundsCount: ROUNDS_COUNT },
    create: {
      id: DEMO_TOURNAMENT_ID,
      name: "Giải Demo USCC 2026",
      startDate,
      endDate,
      venue: "Địa điểm demo, TP.HCM",
      organizer: "USCC",
      roundsCount: ROUNDS_COUNT,
      timezone: "Asia/Ho_Chi_Minh",
      primaryColor: "#1d4ed8",
      secondaryColor: "#f59e0b",
    },
  });

  for (const resultCode of DEFAULT_RESULT_CODES) {
    await prisma.resultCode.upsert({
      where: { tournamentId_code: { tournamentId: tournament.id, code: resultCode.code } },
      update: { ...resultCode },
      create: { tournamentId: tournament.id, ...resultCode },
    });
  }
  return tournament;
}

/**
 * Creates the demo players and returns their database IDs in seed order.
 *
 * @param tournamentId - Tournament to attach players to.
 * @returns Player IDs, index-aligned with DEMO_PLAYERS.
 */
async function upsertDemoPlayers(tournamentId: string): Promise<string[]> {
  const playerIds: string[] = [];
  for (const demoPlayer of DEMO_PLAYERS) {
    const player = await prisma.player.upsert({
      where: {
        tournamentId_swissManagerPlayerId: {
          tournamentId,
          swissManagerPlayerId: demoPlayer.swissManagerPlayerId,
        },
      },
      update: { fullName: demoPlayer.fullName, clubOrFederation: demoPlayer.clubOrFederation, rating: demoPlayer.rating },
      create: { tournamentId, ...demoPlayer },
    });
    playerIds.push(player.id);
  }
  return playerIds;
}

/**
 * Creates rounds and games. Round 1 pairs top half vs bottom half; round 2 shifts the bottom half
 * by one so nobody meets the same opponent twice. Every game gets a Result row in state NONE,
 * which the state machine later moves forward.
 *
 * @param tournamentId - Tournament to attach rounds to.
 * @param playerIds - Player IDs from upsertDemoPlayers.
 */
async function upsertDemoRoundsAndGames(tournamentId: string, playerIds: string[]) {
  const halfSize = BOARDS_PER_ROUND;
  for (let roundNumber = 1; roundNumber <= ROUNDS_COUNT; roundNumber++) {
    const round = await prisma.round.upsert({
      where: { tournamentId_roundNumber: { tournamentId, roundNumber } },
      update: { status: RoundStatus.PUBLISHED },
      create: { tournamentId, roundNumber, status: RoundStatus.PUBLISHED },
    });

    for (let boardNumber = 1; boardNumber <= BOARDS_PER_ROUND; boardNumber++) {
      const topIndex = boardNumber - 1;
      const bottomIndex = halfSize + ((boardNumber - 1 + (roundNumber - 1)) % halfSize);
      // Alternate colours between rounds so the demo looks like a real Swiss draw.
      const isTopPlayerWhite = (boardNumber + roundNumber) % 2 === 0;
      const whitePlayerId = playerIds[isTopPlayerWhite ? topIndex : bottomIndex];
      const blackPlayerId = playerIds[isTopPlayerWhite ? bottomIndex : topIndex];
      if (whitePlayerId === undefined || blackPlayerId === undefined) {
        throw new Error(`Demo pairing out of range on round ${roundNumber}, board ${boardNumber}`);
      }

      const game = await prisma.game.upsert({
        where: { roundId_boardNumber: { roundId: round.id, boardNumber } },
        update: {},
        create: {
          roundId: round.id,
          boardNumber,
          whitePlayerId,
          blackPlayerId,
          whitePointsBefore: roundNumber === 1 ? 0 : null,
          blackPointsBefore: roundNumber === 1 ? 0 : null,
        },
      });
      await prisma.result.upsert({
        where: { gameId: game.id },
        update: {},
        create: { gameId: game.id, status: ResultStatus.NONE },
      });
    }
  }
}

/**
 * Seeds all demo data and prints the demo logins.
 */
async function seedDatabase() {
  console.warn("Seeding database…");

  const technicalUsername = process.env.SEED_TD_USERNAME ?? "td_demo";
  const technicalPassword = process.env.SEED_TD_PASSWORD ?? "TdDemo-2026!";
  const recorderUsername = process.env.SEED_RECORDER_USERNAME ?? "recorder_demo";
  const recorderPassword = process.env.SEED_RECORDER_PASSWORD ?? "RecDemo-2026!";

  await upsertDemoUser(technicalUsername, technicalPassword, Role.TECHNICAL);
  await upsertDemoUser(recorderUsername, recorderPassword, Role.RECORDER);
  console.warn(`  ✓ Users: ${technicalUsername} (TECHNICAL), ${recorderUsername} (RECORDER)`);

  const tournament = await upsertDemoTournament();
  console.warn(`  ✓ Tournament "${tournament.name}" with ${DEFAULT_RESULT_CODES.length} result codes`);

  const playerIds = await upsertDemoPlayers(tournament.id);
  console.warn(`  ✓ Players: ${playerIds.length}`);

  await upsertDemoRoundsAndGames(tournament.id, playerIds);
  console.warn(`  ✓ Rounds: ${ROUNDS_COUNT} × ${BOARDS_PER_ROUND} boards`);
  console.warn("Seed complete. Demo logins are listed in README.md → Setup.");
}

seedDatabase()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    prisma.$disconnect().catch(console.error);
  });
