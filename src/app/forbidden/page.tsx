// src/app/forbidden/page.tsx
// Shown when a signed-in arbiter opens a page their role does not allow (SRS-AUTH-06).
// Still requires a session: anonymous visitors are sent to /login by the middleware.

import Link from "next/link";
import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { AppHeader } from "@/components/app-header";

/**
 * Access-denied page.
 *
 * @returns An explanation and a link home.
 */
export default async function ForbiddenPage() {
  const signedInUser = await requirePageUser("LOOK_UP_GAMES");
  return (
    <>
      <AppHeader signedInUser={signedInUser} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold">{vi.errors.forbiddenTitle}</h1>
        <p className="mt-2 text-gray-700">{vi.errors.forbidden}</p>
        <Link href="/" className="mt-4 inline-block text-brand-primary underline">
          {vi.errors.goHome}
        </Link>
      </main>
    </>
  );
}
