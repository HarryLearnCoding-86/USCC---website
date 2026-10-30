// src/server/domain/search-text-normalizer.ts
// Normalizes names for search and matching. SRS-LOOK-02: "nguyen van a" must match "Nguyễn Văn A";
// SRS-IMP-08: name matching applies case, whitespace and Unicode normalization.

/**
 * Removes Vietnamese diacritics, lower-cases and collapses whitespace.
 * "đ"/"Đ" is a separate letter in Unicode (not a base letter plus a mark), so it is mapped explicitly.
 *
 * @param text - Any user-entered or stored text.
 * @returns The comparable form, e.g. "Nguyễn  Văn Ân" → "nguyen van an".
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes a name for exact matching between records: keeps diacritics (two different Vietnamese names
 * can differ only by a tone mark) but unifies Unicode form, case and whitespace.
 *
 * @param fullName - A player's name.
 * @returns The canonical form used for "same name" checks.
 */
export function normalizePlayerNameForMatching(fullName: string): string {
  return fullName.normalize("NFC").toLocaleLowerCase("vi").replace(/\s+/g, " ").trim();
}
