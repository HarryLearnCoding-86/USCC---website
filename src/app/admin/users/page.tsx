// src/app/admin/users/page.tsx
// /admin/users — account management for TECHNICAL users only (SRS-AUTH-07, BR-16).

import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { listUserAccounts } from "@/server/services/user-account-service";
import { AppHeader } from "@/components/app-header";
import { UserManagementPanel } from "@/components/user-management-panel";

/**
 * Account management page.
 *
 * @returns The page; redirects to /login or /forbidden when access is denied.
 */
export default async function AdminUsersPage() {
  const signedInUser = await requirePageUser("MANAGE_ACCOUNTS");
  const users = await listUserAccounts();
  return (
    <>
      <AppHeader signedInUser={signedInUser} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">{vi.adminUsers.pageTitle}</h1>
        <UserManagementPanel initialUsers={users} currentUserId={signedInUser.id} />
      </main>
    </>
  );
}
