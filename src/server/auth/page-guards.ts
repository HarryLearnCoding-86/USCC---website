// src/server/auth/page-guards.ts
// Guards for server-rendered pages. Every page except /login calls requirePageUser, so access control
// lives on the server and not only in hidden links (SRS-AUTH-01, SRS-AUTH-06).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { findSignedInUserBySessionToken, type SignedInUser } from "@/server/auth/session-store";
import { hasPermission, type Permission } from "@/server/auth/role-permissions";

/**
 * Reads the session cookie of the current request and resolves the signed-in user.
 *
 * @returns The user, or null when there is no valid session.
 */
export async function getSignedInUserForPage(): Promise<SignedInUser | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return null;
  }
  return findSignedInUserBySessionToken(sessionToken);
}

/**
 * Ensures the current request has a signed-in user with a permission.
 * Unauthenticated requests go to /login; authenticated users lacking the permission go to /forbidden.
 *
 * @param permission - Permission the page requires.
 * @returns The signed-in user.
 * @throws Next.js redirect signal (never returns) when access is denied.
 */
export async function requirePageUser(permission: Permission): Promise<SignedInUser> {
  const signedInUser = await getSignedInUserForPage();
  if (!signedInUser) {
    redirect("/login");
  }
  if (!hasPermission(signedInUser.role, permission)) {
    redirect("/forbidden");
  }
  return signedInUser;
}
