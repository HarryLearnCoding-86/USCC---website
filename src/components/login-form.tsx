// src/components/login-form.tsx
// Client login form (SRS-AUTH-01). Shows the server's Vietnamese error message as-is and
// goes to the home page on success. Inputs are 44 px+ tall for phone use (NFR-10).

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { vi } from "@/i18n/vi";
import type { ApiErrorResponseBody } from "@/client/api-request";

/**
 * Username / password form.
 *
 * @returns The login form element.
 */
export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as ApiErrorResponseBody | null;
        setErrorMessage(errorBody?.messageVi ?? vi.common.error);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setErrorMessage(vi.apiErrors.serverError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submitLogin} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{vi.auth.usernameLabel}</span>
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(changeEvent) => setUsername(changeEvent.target.value)}
          placeholder={vi.auth.usernamePlaceholder}
          className="min-h-[44px] rounded-md border border-gray-300 px-3"
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{vi.auth.passwordLabel}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          placeholder={vi.auth.passwordPlaceholder}
          className="min-h-[44px] rounded-md border border-gray-300 px-3"
          required
        />
      </label>
      {errorMessage && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      )}
      <button type="submit" disabled={isSubmitting} className="btn-primary min-h-[48px] text-base">
        {isSubmitting ? vi.auth.loggingIn : vi.auth.loginButton}
      </button>
    </form>
  );
}
