// src/components/page-shell.tsx
// Common frame for signed-in pages: the app header and a centred main area.

import type { ReactNode } from "react";
import type { SignedInUser } from "@/server/auth/session-store";
import { AppHeader } from "@/components/app-header";

/**
 * Page frame.
 *
 * @param props.signedInUser - Viewer shown in the header.
 * @param props.children - Page content.
 * @param props.isWide - Use the wide layout (console, manual entry) instead of the reading width.
 * @returns Header plus main element.
 */
export function PageShell({ signedInUser, children, isWide = false }: { signedInUser: SignedInUser; children: ReactNode; isWide?: boolean }) {
  return (
    <>
      <AppHeader signedInUser={signedInUser} />
      <main className={`mx-auto px-4 py-6 ${isWide ? "max-w-7xl" : "max-w-5xl"}`}>{children}</main>
    </>
  );
}
