// src/components/tournament-logo.tsx
// Small tournament logo shown next to the tournament name in lists and page headings. Decorative (empty alt):
// the name right beside it already says which tournament it is, so screen readers skip the image.

/** Pixel sizes per place the logo appears. */
const LOGO_SIZE_CLASS_NAMES = { list: "h-10 w-10", heading: "h-12 w-12" } as const;

/**
 * Tournament logo, or nothing when the tournament has none.
 *
 * @param props.logoUrl - From buildTournamentLogoUrl; null renders nothing.
 * @param props.size - "list" for list rows, "heading" next to a page title.
 * @returns An image or null.
 */
export function TournamentLogo({ logoUrl, size }: { logoUrl: string | null; size: keyof typeof LOGO_SIZE_CLASS_NAMES }) {
  if (!logoUrl) return null;
  return (
    // A plain <img>: the logo is served by an authenticated route and must not go through image optimisation.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className={`${LOGO_SIZE_CLASS_NAMES[size]} shrink-0 rounded bg-white object-contain p-0.5`} data-testid="tournament-logo" />
  );
}
