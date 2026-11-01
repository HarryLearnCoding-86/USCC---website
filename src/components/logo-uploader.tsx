// src/components/logo-uploader.tsx
// Logo upload on the settings page (SRS-TOUR-02). Sends multipart/form-data with an Idempotency-Key; the server
// checks type (by content) and size and returns a Vietnamese message on failure.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { vi } from "@/i18n/vi";
import { generateIdempotencyKey, readApiErrorMessage, readCsrfToken } from "@/client/api-request";
import { FeedbackBanner, type FeedbackMessage } from "@/components/feedback-banner";

/**
 * Logo uploader with the current logo preview.
 *
 * @param props.tournamentId - Tournament ID.
 * @param props.logoUrl - Current logo URL, or null.
 * @returns The upload form.
 */
export function LogoUploader({ tournamentId, logoUrl }: { tournamentId: string; logoUrl: string | null }) {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackMessage | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function uploadLogo(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!selectedFile) {
      setFeedbackMessage({ isError: true, text: vi.logo.missingFile });
      return;
    }
    setIsUploading(true);
    const formData = new FormData();
    formData.append("logo", selectedFile);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/logo`, {
        method: "POST",
        headers: { "Idempotency-Key": generateIdempotencyKey(), "X-CSRF-Token": readCsrfToken() },
        body: formData,
        credentials: "same-origin",
      });
      if (!response.ok) {
        setFeedbackMessage({ isError: true, text: readApiErrorMessage(await response.json().catch(() => null), vi.common.error) });
        return;
      }
      setFeedbackMessage({ isError: false, text: vi.logo.uploadSuccess });
      router.refresh();
    } catch {
      setFeedbackMessage({ isError: true, text: vi.apiErrors.serverError });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form onSubmit={uploadLogo} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
      {logoUrl ? (
        // Plain <img>: the logo comes from an authenticated API route, not a static asset.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={vi.projection.logoAlt} className="h-16 w-auto rounded border border-gray-200" data-testid="logo-preview" />
      ) : (
        <p className="text-sm text-gray-600">{vi.logo.noLogo}</p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        {vi.logo.uploadLabel}
        <input
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          onChange={(changeEvent) => setSelectedFile(changeEvent.target.files?.[0] ?? null)}
          className="min-h-[44px]"
        />
      </label>
      <button type="submit" disabled={isUploading} className="btn-primary min-h-[44px]">{vi.logo.uploadButton}</button>
      <div className="w-full"><FeedbackBanner feedbackMessage={feedbackMessage} /></div>
    </form>
  );
}
