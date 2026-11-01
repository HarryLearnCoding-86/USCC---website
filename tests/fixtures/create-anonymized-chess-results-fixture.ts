// tests/fixtures/create-anonymized-chess-results-fixture.ts
// Builds tests/fixtures/chess-results-round-1-anonymized.xlsx from the Chess-Results sample in docs/.
// AGENT_PROMPT.md §3.7 asks for the sample as a test fixture, but it contains real player names and CLAUDE.md §2
// forbids real personal data in fixtures. This script keeps the exact layout (sheet name, metadata rows 1–5,
// header row 6, boards in rows 7–46, footer rows, club codes, points and Chess-Results result symbols) and replaces
// every player name and the tournament title with fictional values.
// Run: pnpm exec tsx tests/fixtures/create-anonymized-chess-results-fixture.ts

import path from "node:path";
import ExcelJS from "exceljs";

const SOURCE_PATH = path.resolve("docs/USCC-HCMUS-round-1-Chess-Results.xlsx");
const OUTPUT_PATH = path.resolve("tests/fixtures/chess-results-round-1-anonymized.xlsx");
const WHITE_NAME_COLUMN = 2;
const BLACK_NAME_COLUMN = 7;
const FIRST_BOARD_ROW = 7;

const FAMILY_NAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng"];
const MIDDLE_NAMES = ["Văn", "Thị", "Minh", "Quốc", "Gia", "Thanh", "Ngọc", "Hữu"];
const GIVEN_NAMES = ["An", "Bình", "Châu", "Dũng", "Giang", "Hà", "Khoa", "Lâm", "My", "Nam", "Phúc", "Quân", "Sơn", "Tâm", "Uyên", "Vy"];

/**
 * Deterministic fictional name for a player number, so the fixture is stable across runs.
 *
 * @param playerNumber - 0-based index of the player in the file.
 * @returns A Vietnamese-looking fictional name.
 */
function buildFictionalName(playerNumber: number): string {
  const familyName = FAMILY_NAMES[playerNumber % FAMILY_NAMES.length];
  const middleName = MIDDLE_NAMES[Math.floor(playerNumber / FAMILY_NAMES.length) % MIDDLE_NAMES.length];
  const givenName = GIVEN_NAMES[(playerNumber * 7) % GIVEN_NAMES.length];
  return `${familyName} ${middleName} ${givenName} Mẫu${String(playerNumber + 1).padStart(2, "0")}`;
}

/**
 * Copies the sample, anonymises names and the title, and writes the fixture.
 */
async function createAnonymizedFixture(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(SOURCE_PATH);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Sample workbook has no sheet");

  worksheet.getCell("A2").value = "Giải mẫu ẩn danh — dùng cho kiểm thử nhập cặp đấu";
  let playerNumber = 0;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < FIRST_BOARD_ROW) return;
    for (const nameColumn of [WHITE_NAME_COLUMN, BLACK_NAME_COLUMN]) {
      const nameCell = row.getCell(nameColumn);
      if (typeof nameCell.value === "string" && nameCell.value.trim() !== "") {
        nameCell.value = buildFictionalName(playerNumber);
        playerNumber += 1;
      }
    }
  });
  // Drop the footer link to the real tournament page; keep a footer row so importers still see one.
  worksheet.getCell("A48").value = "Nguồn: tệp mẫu đã được ẩn danh";
  await workbook.xlsx.writeFile(OUTPUT_PATH);
  console.warn(`Wrote ${OUTPUT_PATH} with ${playerNumber} fictional players`);
}

createAnonymizedFixture().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
