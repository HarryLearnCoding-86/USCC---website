// src/app/login/page.tsx
// /login — the only public page (SRS-AUTH-01). Signed-in arbiters are sent straight to the home page.

import { redirect } from "next/navigation";
import { vi } from "@/i18n/vi";
import { getSignedInUserForPage } from "@/server/auth/page-guards";
import { LoginForm } from "@/components/login-form";

/**
 * Login page.
 *
 * @returns The login form, or a redirect to / when already signed in.
 */
export default async function LoginPage() {
  if (await getSignedInUserForPage()) {
    redirect("/");
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">{vi.auth.loginTitle}</h1>
      <p className="mb-6 mt-1 text-sm text-gray-600">{vi.auth.loginSubtitle}</p>
      <LoginForm />
    </main>
  );
}
