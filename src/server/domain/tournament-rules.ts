// src/server/domain/tournament-rules.ts
// Pure tournament configuration rules: allowed round counts (SRS-TOUR-01), IANA timezone validity (SRS §9),
// hex colours and the 4.5:1 text-contrast warning for branding (SRS-TOUR-03, NFR-10).

/** SRS-TOUR-01: a tournament has 1–20 rounds. */
export const MINIMUM_ROUNDS_COUNT = 1;
export const MAXIMUM_ROUNDS_COUNT = 20;
/** WCAG AA contrast for normal text (SRS-TOUR-03). */
export const MINIMUM_TEXT_CONTRAST_RATIO = 4.5;

/** Six-digit hex colour, e.g. "#1d4ed8". */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Whether a string is a timezone the runtime recognises.
 *
 * @param timeZone - Candidate IANA name, e.g. "Asia/Ho_Chi_Minh".
 * @returns true when Intl accepts it.
 */
export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * WCAG relative luminance of a hex colour.
 *
 * @param hexColor - "#rrggbb".
 * @returns Luminance between 0 (black) and 1 (white).
 */
function computeRelativeLuminance(hexColor: string): number {
  const channelValues = [1, 3, 5].map((offset) => parseInt(hexColor.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channelValues.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * WCAG contrast ratio between two colours.
 *
 * @param firstHexColor - "#rrggbb".
 * @param secondHexColor - "#rrggbb".
 * @returns Ratio from 1 (identical) to 21 (black on white).
 */
export function computeContrastRatio(firstHexColor: string, secondHexColor: string): number {
  const firstLuminance = computeRelativeLuminance(firstHexColor);
  const secondLuminance = computeRelativeLuminance(secondHexColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Whether white text on a brand colour (headers on the projection screen) falls below 4.5:1.
 *
 * @param brandHexColor - "#rrggbb".
 * @returns true when the TD should be warned (SRS-TOUR-03).
 */
export function hasLowContrastWithWhiteText(brandHexColor: string): boolean {
  return computeContrastRatio(brandHexColor, "#ffffff") < MINIMUM_TEXT_CONTRAST_RATIO;
}
