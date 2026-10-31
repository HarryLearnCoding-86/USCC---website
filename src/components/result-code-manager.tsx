// src/components/result-code-manager.tsx
// Per-tournament result-code editor (SRS-TOUR-05..07): edit rows inline, hide/show, delete unused codes,
// add new ones. The server refuses meaning changes on used codes; this component shows its message.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { vi } from "@/i18n/vi";
import { readApiErrorMessage, sendJsonMutation } from "@/client/api-request";
import { formatScore } from "@/server/domain/result-display";
import type { ResultCodeView } from "@/server/services/game-view-mapper";
import { FeedbackBanner, type FeedbackMessage } from "@/components/feedback-banner";

const SCORE_OPTIONS = [0, 0.5, 1];

/** Editable fields of a code row. */
type ResultCodeDraft = Omit<ResultCodeView, "id" | "isActive">;

/**
 * Result-code manager.
 *
 * @param props.tournamentId - Owning tournament.
 * @param props.resultCodes - Current codes in display order.
 * @returns Table of codes plus an add form.
 */
export function ResultCodeManager({ tournamentId, resultCodes }: { tournamentId: string; resultCodes: ResultCodeView[] }) {
  const router = useRouter();
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackMessage | null>(null);
  const basePath = `/api/tournaments/${tournamentId}/result-codes`;

  async function runMutation(httpMethod: "POST" | "PATCH" | "DELETE", path: string, requestBody: unknown, successText: string): Promise<boolean> {
    const result = await sendJsonMutation(httpMethod, path, requestBody).catch(() => null);
    if (!result || !result.isOk) {
      setFeedbackMessage({ isError: true, text: result ? readApiErrorMessage(result.body, vi.common.error) : vi.apiErrors.serverError });
      return false;
    }
    setFeedbackMessage({ isError: false, text: successText });
    router.refresh();
    return true;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{vi.resultCodes.heading}</h2>
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{vi.resultCodes.proposalNotice}</p>
      <FeedbackBanner feedbackMessage={feedbackMessage} />
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-2 py-2">{vi.resultCodes.codeLabel}</th>
              <th className="px-2 py-2">{vi.resultCodes.labelLabel}</th>
              <th className="px-2 py-2">{vi.resultCodes.whiteScoreLabel}</th>
              <th className="px-2 py-2">{vi.resultCodes.blackScoreLabel}</th>
              <th className="px-2 py-2">{vi.resultCodes.requiresConfirmationLabel}</th>
              <th className="px-2 py-2">{vi.resultCodes.swissManagerValueLabel}</th>
              <th className="px-2 py-2">{vi.resultCodes.sortOrderLabel}</th>
              <th className="px-2 py-2">{vi.resultCodes.statusLabel}</th>
              <th className="px-2 py-2">{vi.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {resultCodes.map((resultCode) => (
              <ResultCodeRow
                key={resultCode.id}
                resultCode={resultCode}
                onSave={(changedFields) => runMutation("PATCH", `${basePath}/${resultCode.id}`, changedFields, vi.resultCodes.saved)}
                onToggleActive={() => runMutation("PATCH", `${basePath}/${resultCode.id}`, { isActive: !resultCode.isActive }, vi.resultCodes.saved)}
                onDelete={() => {
                  if (window.confirm(vi.resultCodes.deleteConfirm(resultCode.code))) {
                    void runMutation("DELETE", `${basePath}/${resultCode.id}`, undefined, vi.resultCodes.deleted);
                  }
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      <NewResultCodeForm onCreate={(draft) => runMutation("POST", basePath, draft, vi.resultCodes.saved)} nextSortOrder={resultCodes.length + 1} />
    </section>
  );
}

/**
 * One editable table row.
 *
 * @param props.resultCode - The code.
 * @param props.onSave - Sends only the changed fields.
 * @param props.onToggleActive - Hides or shows the code.
 * @param props.onDelete - Deletes the code (server refuses when used).
 * @returns A table row.
 */
function ResultCodeRow({
  resultCode,
  onSave,
  onToggleActive,
  onDelete,
}: {
  resultCode: ResultCodeView;
  onSave: (changedFields: Partial<ResultCodeDraft>) => Promise<boolean>;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<ResultCodeDraft>(resultCode);
  const changedFields = Object.fromEntries(
    (Object.keys(draft) as (keyof ResultCodeDraft)[]).filter((fieldName) => draft[fieldName] !== resultCode[fieldName]).map((fieldName) => [fieldName, draft[fieldName]]),
  ) as Partial<ResultCodeDraft>;
  const hasChanges = Object.keys(changedFields).length > 0;
  const cellInputClassName = "min-h-[40px] w-full rounded border border-gray-300 px-2";

  return (
    <tr className={`border-t border-gray-100 ${resultCode.isActive ? "" : "text-gray-400"}`} data-testid={`result-code-row-${resultCode.code}`}>
      <td className="px-2 py-1"><input aria-label={vi.resultCodes.codeLabel} value={draft.code} onChange={(changeEvent) => setDraft({ ...draft, code: changeEvent.target.value })} className={`${cellInputClassName} w-20`} /></td>
      <td className="px-2 py-1"><input aria-label={vi.resultCodes.labelLabel} value={draft.labelVi} onChange={(changeEvent) => setDraft({ ...draft, labelVi: changeEvent.target.value })} className={`${cellInputClassName} min-w-[12rem]`} /></td>
      {(["whiteScore", "blackScore"] as const).map((fieldName) => (
        <td key={fieldName} className="px-2 py-1">
          <select aria-label={fieldName === "whiteScore" ? vi.resultCodes.whiteScoreLabel : vi.resultCodes.blackScoreLabel} value={draft[fieldName]} onChange={(changeEvent) => setDraft({ ...draft, [fieldName]: Number(changeEvent.target.value) })} className={cellInputClassName}>
            {SCORE_OPTIONS.map((score) => <option key={score} value={score}>{formatScore(score)}</option>)}
          </select>
        </td>
      ))}
      <td className="px-2 py-1 text-center"><input aria-label={vi.resultCodes.requiresConfirmationLabel} type="checkbox" checked={draft.requiresPlayerConfirmation} onChange={(changeEvent) => setDraft({ ...draft, requiresPlayerConfirmation: changeEvent.target.checked })} className="h-5 w-5" /></td>
      <td className="px-2 py-1"><input aria-label={vi.resultCodes.swissManagerValueLabel} value={draft.swissManagerValue ?? ""} onChange={(changeEvent) => setDraft({ ...draft, swissManagerValue: changeEvent.target.value === "" ? null : changeEvent.target.value })} className={`${cellInputClassName} w-20`} /></td>
      <td className="px-2 py-1"><input aria-label={vi.resultCodes.sortOrderLabel} type="number" value={draft.sortOrder} onChange={(changeEvent) => setDraft({ ...draft, sortOrder: Number(changeEvent.target.value) })} className={`${cellInputClassName} w-16`} /></td>
      <td className="px-2 py-1">{resultCode.isActive ? vi.resultCodes.activeLabel : vi.resultCodes.hiddenLabel}</td>
      <td className="flex gap-1 px-2 py-1">
        <button type="button" className="btn-secondary min-h-[40px]" disabled={!hasChanges} onClick={() => void onSave(changedFields)}>{vi.resultCodes.saveButton}</button>
        <button type="button" className="btn-secondary min-h-[40px]" onClick={onToggleActive}>{resultCode.isActive ? vi.resultCodes.hideButton : vi.resultCodes.showButton}</button>
        <button type="button" className="btn-secondary min-h-[40px]" onClick={onDelete}>{vi.resultCodes.deleteButton}</button>
      </td>
    </tr>
  );
}

/**
 * Form for adding a code.
 *
 * @param props.onCreate - Sends the new code; resolves true on success.
 * @param props.nextSortOrder - Default display order.
 * @returns The form element.
 */
function NewResultCodeForm({ onCreate, nextSortOrder }: { onCreate: (draft: ResultCodeDraft) => Promise<boolean>; nextSortOrder: number }) {
  const emptyDraft: ResultCodeDraft = { code: "", labelVi: "", whiteScore: 1, blackScore: 0, requiresPlayerConfirmation: true, swissManagerValue: null, sortOrder: nextSortOrder };
  const [draft, setDraft] = useState<ResultCodeDraft>(emptyDraft);

  async function submitNewCode(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (await onCreate(draft)) {
      setDraft({ ...emptyDraft, sortOrder: nextSortOrder + 1 });
    }
  }

  const inputClassName = "min-h-[44px] rounded-md border border-gray-300 px-3";
  return (
    <form onSubmit={submitNewCode} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-gray-300 p-3 text-sm">
      <label className="flex flex-col gap-1">{vi.resultCodes.codeLabel}<input value={draft.code} onChange={(changeEvent) => setDraft({ ...draft, code: changeEvent.target.value })} className={`${inputClassName} w-24`} required /></label>
      <label className="flex flex-col gap-1">{vi.resultCodes.labelLabel}<input value={draft.labelVi} onChange={(changeEvent) => setDraft({ ...draft, labelVi: changeEvent.target.value })} className={inputClassName} required /></label>
      {(["whiteScore", "blackScore"] as const).map((fieldName) => (
        <label key={fieldName} className="flex flex-col gap-1">
          {fieldName === "whiteScore" ? vi.resultCodes.whiteScoreLabel : vi.resultCodes.blackScoreLabel}
          <select value={draft[fieldName]} onChange={(changeEvent) => setDraft({ ...draft, [fieldName]: Number(changeEvent.target.value) })} className={inputClassName}>
            {SCORE_OPTIONS.map((score) => <option key={score} value={score}>{formatScore(score)}</option>)}
          </select>
        </label>
      ))}
      <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" checked={draft.requiresPlayerConfirmation} onChange={(changeEvent) => setDraft({ ...draft, requiresPlayerConfirmation: changeEvent.target.checked })} className="h-5 w-5" />{vi.resultCodes.requiresConfirmationLabel}</label>
      <label className="flex flex-col gap-1">{vi.resultCodes.swissManagerValueLabel}<input value={draft.swissManagerValue ?? ""} onChange={(changeEvent) => setDraft({ ...draft, swissManagerValue: changeEvent.target.value === "" ? null : changeEvent.target.value })} className={`${inputClassName} w-24`} /></label>
      <button type="submit" className="btn-primary min-h-[44px]">{vi.resultCodes.addButton}</button>
    </form>
  );
}
