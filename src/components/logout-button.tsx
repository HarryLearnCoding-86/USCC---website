// src/components/logout-button.tsx
// Client button that ends the session and returns to /login.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { vi } from "@/i18n/vi";
import { sendJsonMutation } from "@/client/api-request";

/**
 * Logout button.
 *
 * @returns A button that signs the arbiter out.
 */
export function LogoutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    // Navigate to /login even if the request fails: the server session expires on its own.
    await sendJsonMutation("POST", "/api/auth/logout").catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={signOut} disabled={isSigningOut} className="btn-secondary min-h-[44px]">
      {vi.auth.logoutButton}
    </button>
  );
}
