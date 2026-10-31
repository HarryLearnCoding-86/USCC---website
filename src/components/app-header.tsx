// src/components/app-header.tsx
// Top bar shown on every signed-in page: app name, role-aware links and the logout button.
// Links are hidden by role for convenience only; the server still guards every route (SRS-AUTH-06).

import Link from "next/link";
import { vi } from "@/i18n/vi";
import type { SignedInUser } from "@/server/auth/session-store";
import { hasPermission } from "@/server/auth/role-permissions";
import { LogoutButton } from "@/components/logout-button";

/**
 * Renders the application header.
 *
 * @param props.signedInUser - The arbiter viewing the page.
 * @returns The header element.
 */
export function AppHeader({ signedInUser }: { signedInUser: SignedInUser }) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <nav className="flex items-center gap-4">
          <Link href="/" className="font-semibold text-brand-primary">
            {vi.common.appName}
          </Link>
          {hasPermission(signedInUser.role, "MANAGE_ACCOUNTS") && (
            <Link href="/admin/users" className="text-sm text-gray-700 underline-offset-2 hover:underline">
              {vi.nav.users}
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <span data-testid="signed-in-user">
            {vi.nav.signedInAs(signedInUser.username, vi.roles[signedInUser.role])}
          </span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
