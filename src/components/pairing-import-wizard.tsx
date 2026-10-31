// src/components/pairing-import-wizard.tsx
// TD import wizard (SRS-IMP-01..09, §5): upload → choose sheet and header row → map columns → preview with
// per-cell errors, row exclusion, player choices for ambiguous names and the round diff → confirm. The server
// validates everything; this component only collects choices and shows the server's Vietnamese messages.

"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { vi } from "@/i18n/vi";
import { generateIdempotencyKey, readApiErrorMessage, readCsrfToken, sendJsonMutation } from "@/client/api-request";
import { convertColumnNumberToLetter, PAIRING_IMPORT_FIELDS, REQUIRED_MAPPED_FIELDS, type PairingColumnMapping } from "@/server/domain/pairing-import-rules";
import { formatScore } from "@/server/domain/result-display";
import type { WorkbookOutline } from "@/server/import/pairing-importer";
import type { ImportPreview, SavedImportMapping } from "@/server/services/pairing-import-service";
import { FeedbackBanner, type FeedbackMessage } from "@/components/feedback-banner";

type WizardStep = "UPLOAD" | "SHEET" | "MAPPING" | "PREVIEW" | "DONE";
type PublicImportPreview = Omit<ImportPreview, "targetsByChoiceKey">;

/** Response of the upload step. */
interface UploadResponse {
  uploadId: string;
  originalFilename: string;
  outline: WorkbookOutline;
  savedMapping: SavedImportMapping | null;
}

/**
 * Import wizard.
 *
 * @param props.tournamentId - Tournament ID.
 * @param props.roundNumbers - Rounds the TD can import into.
 * @returns The current wizard step.
 */
export function PairingImportWizard({ tournamentId, roundNumbers }: { tournamentId: string; roundNumbers: number[] }) {
  const [step, setStep] = useState<WizardStep>("UPLOAD");
  const [roundNumber, setRoundNumber] = useState(roundNumbers[0] ?? 1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [headerRowNumber, setHeaderRowNumber] = useState(1);
  const [columnMapping, setColumnMapping] = useState<PairingColumnMapping>({});
  const [preview, setPreview] = useState<PublicImportPreview | null>(null);
  const [excludedRowNumbers, setExcludedRowNumbers] = useState<number[]>([]);
  const [playerChoices, setPlayerChoices] = useState<Record<string, string>>({});
  const [isResultReplacementConfirmed, setIsResultReplacementConfirmed] = useState(false);
  const [importedGameCount, setImportedGameCount] = useState(0);
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackMessage | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const sheetOutline = upload?.outline.sheets.find((sheet) => sheet.sheetName === sheetName) ?? null;

  async function uploadWorkbook(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!selectedFile) return;
    setIsBusy(true);
    setFeedbackMessage(null);
    const formData = new FormData();
    formData.append("workbook", selectedFile);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/imports`, {
        method: "POST",
        headers: { "Idempotency-Key": generateIdempotencyKey(), "X-CSRF-Token": readCsrfToken() },
        body: formData,
        credentials: "same-origin",
      });
      const responseBody = (await response.json().catch(() => null)) as UploadResponse | null;
      if (!response.ok || !responseBody) {
        setFeedbackMessage({ isError: true, text: readApiErrorMessage(responseBody, vi.common.error) });
        return;
      }
      const savedSheet = responseBody.outline.sheets.find((sheet) => sheet.sheetName === responseBody.savedMapping?.sheetName);
      const initialSheet = savedSheet ?? responseBody.outline.sheets[0];
      setUpload(responseBody);
      setSheetName(initialSheet?.sheetName ?? "");
      setHeaderRowNumber(responseBody.savedMapping?.headerRowNumber ?? initialSheet?.detectedHeaderRowNumber ?? 1);
      setColumnMapping(responseBody.savedMapping?.columnMapping ?? {});
      setStep("SHEET");
    } catch {
      setFeedbackMessage({ isError: true, text: vi.apiErrors.serverError });
    } finally {
      setIsBusy(false);
    }
  }

  async function requestPreview(overrides: { excludedRowNumbers?: number[]; playerChoices?: Record<string, string> } = {}) {
    if (!upload) return;
    setIsBusy(true);
    setFeedbackMessage(null);
    const result = await sendJsonMutation<{ preview: PublicImportPreview }>("POST", `/api/tournaments/${tournamentId}/imports/preview`, {
      uploadId: upload.uploadId,
      roundNumber,
      sheetName,
      headerRowNumber,
      columnMapping,
      excludedRowNumbers: overrides.excludedRowNumbers ?? excludedRowNumbers,
      playerChoices: overrides.playerChoices ?? playerChoices,
    }).catch(() => null);
    setIsBusy(false);
    if (!result || !result.isOk) {
      setFeedbackMessage({ isError: true, text: result ? readApiErrorMessage(result.body, vi.common.error) : vi.apiErrors.serverError });
      return;
    }
    setPreview(result.body.preview);
    setStep("PREVIEW");
  }

  async function confirmImport() {
    if (!upload) return;
    setIsBusy(true);
    setFeedbackMessage(null);
    const result = await sendJsonMutation<{ gameCount: number }>("POST", `/api/tournaments/${tournamentId}/imports/${upload.uploadId}/confirm`, {
      roundNumber,
      sheetName,
      headerRowNumber,
      columnMapping,
      excludedRowNumbers,
      playerChoices,
      originalFilename: upload.originalFilename,
      isResultReplacementConfirmed,
    }).catch(() => null);
    setIsBusy(false);
    if (!result || !result.isOk) {
      setFeedbackMessage({ isError: true, text: result ? readApiErrorMessage(result.body, vi.common.error) : vi.apiErrors.serverError });
      return;
    }
    setImportedGameCount(result.body.gameCount);
    setStep("DONE");
  }

  function toggleExcludedRow(rowNumber: number) {
    const nextExcluded = excludedRowNumbers.includes(rowNumber)
      ? excludedRowNumbers.filter((excludedRow) => excludedRow !== rowNumber)
      : [...excludedRowNumbers, rowNumber];
    setExcludedRowNumbers(nextExcluded);
    void requestPreview({ excludedRowNumbers: nextExcluded });
  }

  function choosePlayer(choiceKey: string, playerChoice: string) {
    const nextChoices = { ...playerChoices, [choiceKey]: playerChoice };
    setPlayerChoices(nextChoices);
    void requestPreview({ playerChoices: nextChoices });
  }

  const missingRequiredField = REQUIRED_MAPPED_FIELDS.find((fieldName) => !columnMapping[fieldName]);
  const selectClassName = "min-h-[44px] rounded-md border border-gray-300 px-3";

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label={vi.importExport.importTitle}>
        {(["UPLOAD", "SHEET", "MAPPING", "PREVIEW", "DONE"] as const).map((stepName, stepIndex) => (
          <li key={stepName} className={`rounded px-2 py-1 ${stepName === step ? "bg-brand-primary text-white" : "bg-gray-100"}`}>
            {[vi.importExport.stepUpload, vi.importExport.stepSheet, vi.importExport.stepMapping, vi.importExport.stepPreview, vi.importExport.stepDone][stepIndex]}
          </li>
        ))}
      </ol>
      <FeedbackBanner feedbackMessage={feedbackMessage} />

      {step === "UPLOAD" && (
        <form onSubmit={uploadWorkbook} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <label className="flex flex-col gap-1 text-sm">
            {vi.importExport.roundLabel}
            <select value={roundNumber} onChange={(changeEvent) => setRoundNumber(Number(changeEvent.target.value))} className={selectClassName}>
              {roundNumbers.map((availableRound) => <option key={availableRound} value={availableRound}>{vi.rounds.roundTitle(availableRound)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {vi.importExport.fileLabel}
            <input name="workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(changeEvent) => setSelectedFile(changeEvent.target.files?.[0] ?? null)} className="min-h-[44px]" />
          </label>
          <button type="submit" disabled={!selectedFile || isBusy} className="btn-primary min-h-[44px]">{vi.importExport.uploadButton}</button>
        </form>
      )}

      {step === "SHEET" && upload && (
        <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {vi.importExport.sheetLabel}
              <select value={sheetName} onChange={(changeEvent) => {
                const nextSheet = upload.outline.sheets.find((sheet) => sheet.sheetName === changeEvent.target.value);
                setSheetName(changeEvent.target.value);
                setHeaderRowNumber(nextSheet?.detectedHeaderRowNumber ?? 1);
              }} className={selectClassName}>
                {upload.outline.sheets.map((sheet) => <option key={sheet.sheetName} value={sheet.sheetName}>{sheet.sheetName}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {vi.importExport.headerRowLabel}
              <input type="number" min={1} value={headerRowNumber} onChange={(changeEvent) => setHeaderRowNumber(Math.max(1, Number(changeEvent.target.value)))} className={`${selectClassName} w-28`} />
            </label>
          </div>
          <p className="text-sm text-gray-600">
            {sheetOutline?.detectedHeaderRowNumber ? vi.importExport.detectedHeaderNote(sheetOutline.detectedHeaderRowNumber) : vi.importExport.noHeaderDetected}
          </p>
          {sheetOutline && <SheetPreviewTable sheetOutline={sheetOutline} headerRowNumber={headerRowNumber} />}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setStep("UPLOAD")}>{vi.importExport.backButton}</button>
            <button type="button" className="btn-primary min-h-[44px]" onClick={() => setStep("MAPPING")}>{vi.importExport.nextButton}</button>
          </div>
        </section>
      )}

      {step === "MAPPING" && sheetOutline && (
        <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="font-semibold">{vi.importExport.mappingHeading}</h2>
          {upload?.savedMapping && <p className="text-sm text-gray-600">{vi.importExport.savedMappingNote}</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PAIRING_IMPORT_FIELDS.map((fieldName) => {
              const headerRow = sheetOutline.previewRows.find((row) => row.rowNumber === headerRowNumber);
              return (
                <label key={fieldName} className="flex flex-col gap-1 text-sm">
                  {vi.importExport.fieldLabels[fieldName]}{REQUIRED_MAPPED_FIELDS.includes(fieldName) ? " *" : ""}
                  <select
                    aria-label={vi.importExport.fieldLabels[fieldName]}
                    value={columnMapping[fieldName] ?? ""}
                    onChange={(changeEvent) => setColumnMapping({ ...columnMapping, [fieldName]: changeEvent.target.value || undefined })}
                    className={selectClassName}
                  >
                    <option value="">{vi.importExport.notMapped}</option>
                    {Array.from({ length: sheetOutline.columnCount }, (_unused, columnIndex) => {
                      const columnLetter = convertColumnNumberToLetter(columnIndex + 1);
                      const headerText = headerRow?.cellTextByColumnLetter[columnLetter];
                      return <option key={columnLetter} value={columnLetter}>{headerText ? `${columnLetter} — ${headerText}` : columnLetter}</option>;
                    })}
                  </select>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-gray-600">{vi.importExport.resultColumnNote}</p>
          {missingRequiredField && <p className="text-sm text-amber-800">{vi.importExport.requiredFieldMissing(vi.importExport.fieldLabels[missingRequiredField] ?? missingRequiredField)}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setStep("SHEET")}>{vi.importExport.backButton}</button>
            <button type="button" className="btn-primary min-h-[44px]" disabled={Boolean(missingRequiredField) || isBusy} onClick={() => void requestPreview()}>{vi.importExport.previewButton}</button>
          </div>
        </section>
      )}

      {step === "PREVIEW" && preview && (
        <ImportPreviewPanel
          preview={preview}
          excludedRowNumbers={excludedRowNumbers}
          playerChoices={playerChoices}
          isResultReplacementConfirmed={isResultReplacementConfirmed}
          isBusy={isBusy}
          onToggleExcludedRow={toggleExcludedRow}
          onChoosePlayer={choosePlayer}
          onToggleReplacementConfirmed={setIsResultReplacementConfirmed}
          onBack={() => setStep("MAPPING")}
          onConfirm={() => void confirmImport()}
        />
      )}

      {step === "DONE" && (
        <section className="flex flex-col gap-3 rounded-lg border border-green-200 bg-green-50 p-4" data-testid="import-done">
          <p className="font-semibold text-green-900">{vi.importExport.importSuccess(importedGameCount, roundNumber)}</p>
          <Link href={`/tournaments/${tournamentId}/rounds/${roundNumber}`} className="btn-primary inline-flex min-h-[44px] items-center self-start">{vi.importExport.viewRoundLink}</Link>
        </section>
      )}
    </div>
  );
}

/**
 * First rows of a sheet with row numbers and column letters, header row highlighted.
 *
 * @param props.sheetOutline - Sheet outline from the upload step.
 * @param props.headerRowNumber - Chosen header row.
 * @returns A scrollable table.
 */
function SheetPreviewTable({ sheetOutline, headerRowNumber }: { sheetOutline: WorkbookOutline["sheets"][number]; headerRowNumber: number }) {
  const columnLetters = Array.from({ length: sheetOutline.columnCount }, (_unused, columnIndex) => convertColumnNumberToLetter(columnIndex + 1));
  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-sm font-medium">{vi.importExport.sheetPreviewHeading}</p>
      <table className="text-xs">
        <thead>
          <tr className="bg-gray-100">
            <th className="px-2 py-1">#</th>
            {columnLetters.map((columnLetter) => <th key={columnLetter} className="px-2 py-1">{columnLetter}</th>)}
          </tr>
        </thead>
        <tbody>
          {sheetOutline.previewRows.map((previewRow) => (
            <tr key={previewRow.rowNumber} className={previewRow.rowNumber === headerRowNumber ? "bg-blue-100 font-semibold" : "border-t border-gray-100"}>
              <td className="px-2 py-1 text-gray-500">{previewRow.rowNumber}</td>
              {columnLetters.map((columnLetter) => <td key={columnLetter} className="max-w-[14rem] truncate px-2 py-1">{previewRow.cellTextByColumnLetter[columnLetter] ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Preview step: issues, rows with exclusion and player choices, diff, confirmation.
 *
 * @returns The preview panel.
 */
function ImportPreviewPanel({
  preview,
  excludedRowNumbers,
  playerChoices,
  isResultReplacementConfirmed,
  isBusy,
  onToggleExcludedRow,
  onChoosePlayer,
  onToggleReplacementConfirmed,
  onBack,
  onConfirm,
}: {
  preview: PublicImportPreview;
  excludedRowNumbers: number[];
  playerChoices: Record<string, string>;
  isResultReplacementConfirmed: boolean;
  isBusy: boolean;
  onToggleExcludedRow: (rowNumber: number) => void;
  onChoosePlayer: (choiceKey: string, playerChoice: string) => void;
  onToggleReplacementConfirmed: (isConfirmed: boolean) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const errorIssues = preview.issues.filter((issue) => issue.severity === "ERROR");
  const noticeIssues = preview.issues.filter((issue) => issue.severity === "NOTICE");
  const issuesByRow = new Map<number, typeof preview.issues>();
  for (const issue of preview.issues) issuesByRow.set(issue.rowNumber, [...(issuesByRow.get(issue.rowNumber) ?? []), issue]);
  const includedRowCount = preview.rows.filter((row) => !row.isExcluded).length;
  const canConfirm = preview.blockingReasons.length === 0 && (!preview.requiresResultReplacementConfirmation || isResultReplacementConfirmed);
  const sideText = (side: { fullName: string; swissManagerPlayerId: string | null; pointsBefore: number | null } | null) =>
    side === null
      ? vi.importExport.byeLabel
      : [side.fullName, side.swissManagerPlayerId ? `#${side.swissManagerPlayerId}` : null, side.pointsBefore === null ? null : `(${formatScore(side.pointsBefore)})`].filter(Boolean).join(" ");

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="import-preview">
      <h2 className="font-semibold">{vi.importExport.previewHeading}</h2>
      <p data-testid="import-preview-summary">{vi.importExport.previewSummary(includedRowCount, errorIssues.length)}</p>
      {errorIssues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-red-50 p-3 text-sm text-red-800" data-testid="import-errors">
          {errorIssues.map((issue) => <li key={`${issue.rowNumber}-${issue.field}-${issue.code}`}>{issue.messageVi}</li>)}
        </ul>
      )}
      {noticeIssues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          {noticeIssues.map((issue) => <li key={`${issue.rowNumber}-${issue.field}-${issue.code}`}>{issue.messageVi}</li>)}
        </ul>
      )}
      {preview.skippedRowNumbers.length > 0 && <p className="text-xs text-gray-600">{vi.importExport.skippedRowsNote(preview.skippedRowNumbers.join(", "))}</p>}
      {excludedRowNumbers.length > 0 && <p className="text-xs text-gray-600">{vi.importExport.excludedRowsNote([...excludedRowNumbers].sort((first, second) => first - second).join(", "))}</p>}

      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-gray-600">
            <tr>
              <th className="px-2 py-1">{vi.importExport.tableRow}</th>
              <th className="px-2 py-1">{vi.rounds.board}</th>
              <th className="px-2 py-1">{vi.rounds.white}</th>
              <th className="px-2 py-1">{vi.rounds.black}</th>
              <th className="px-2 py-1">{vi.rounds.result}</th>
              <th className="px-2 py-1">{vi.importExport.excludeRowLabel}</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const rowIssues = issuesByRow.get(row.rowNumber) ?? [];
              const hasError = rowIssues.some((issue) => issue.severity === "ERROR");
              return (
                <tr key={row.rowNumber} data-testid={`import-row-${row.rowNumber}`} className={`border-t border-gray-100 align-top ${row.isExcluded ? "opacity-40" : hasError ? "bg-red-50" : ""}`}>
                  <td className="px-2 py-1 text-gray-500">{row.rowNumber}</td>
                  <td className="px-2 py-1">{row.boardNumber ?? "?"}</td>
                  <td className="px-2 py-1">
                    {sideText(row.white)}
                    <AmbiguousPlayerChooser rowIssues={rowIssues} field="whiteName" choiceKey={`${row.rowNumber}:WHITE`} playerChoices={playerChoices} onChoosePlayer={onChoosePlayer} />
                  </td>
                  <td className="px-2 py-1">
                    {sideText(row.black)}
                    <AmbiguousPlayerChooser rowIssues={rowIssues} field="blackName" choiceKey={`${row.rowNumber}:BLACK`} playerChoices={playerChoices} onChoosePlayer={onChoosePlayer} />
                  </td>
                  <td className="px-2 py-1 text-gray-500">{row.resultText ?? ""}</td>
                  <td className="px-2 py-1">
                    <input type="checkbox" aria-label={`${vi.importExport.excludeRowLabel} ${row.rowNumber}`} checked={excludedRowNumbers.includes(row.rowNumber)} onChange={() => onToggleExcludedRow(row.rowNumber)} className="h-5 w-5" disabled={isBusy} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section data-testid="import-diff">
        <h3 className="mb-1 font-semibold">{vi.importExport.diffHeading}</h3>
        {preview.diffEntries.every((entry) => entry.kind === "ADDED") ? (
          <p className="text-sm text-gray-600">{vi.importExport.diffNoExistingGames}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-xs">
            {preview.diffEntries.filter((entry) => entry.kind !== "UNCHANGED").map((entry) => (
              <li key={entry.boardNumber} className={`rounded px-2 py-1 ${entry.hasResult ? "bg-red-100 text-red-900" : "bg-gray-100"}`}>
                {vi.rounds.board} {entry.boardNumber}: {vi.importExport.diffKinds[entry.kind]}{entry.hasResult ? ` · ${vi.importExport.diffHasResult}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {preview.blockingReasons.length > 0 && (
        <ul className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">
          {preview.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {preview.requiresResultReplacementConfirmation && (
        <label className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <input type="checkbox" checked={isResultReplacementConfirmed} onChange={(changeEvent) => onToggleReplacementConfirmed(changeEvent.target.checked)} className="mt-1 h-5 w-5" />
          {vi.importExport.confirmReplaceResultsLabel}
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary min-h-[44px]" onClick={onBack}>{vi.importExport.backButton}</button>
        <button type="button" className="btn-primary min-h-[44px]" disabled={!canConfirm || isBusy} onClick={onConfirm}>{vi.importExport.confirmButton}</button>
      </div>
    </section>
  );
}

/**
 * Select for a name that matches several existing players (SRS-IMP-08: the TD chooses or creates a new player).
 *
 * @returns The select, or null when the side has no ambiguity.
 */
function AmbiguousPlayerChooser({
  rowIssues,
  field,
  choiceKey,
  playerChoices,
  onChoosePlayer,
}: {
  rowIssues: PublicImportPreview["issues"];
  field: "whiteName" | "blackName";
  choiceKey: string;
  playerChoices: Record<string, string>;
  onChoosePlayer: (choiceKey: string, playerChoice: string) => void;
}) {
  const ambiguityIssue = rowIssues.find((issue) => issue.field === field && issue.code === "AMBIGUOUS_PLAYER_NAME");
  if (!ambiguityIssue?.details?.candidates) return null;
  return (
    <select
      aria-label={vi.importExport.choosePlayerLabel}
      value={playerChoices[choiceKey] ?? ""}
      onChange={(changeEvent) => onChoosePlayer(choiceKey, changeEvent.target.value)}
      className="mt-1 block min-h-[40px] rounded border border-red-300 px-2 text-xs"
    >
      <option value="">{vi.importExport.choosePlayerLabel}</option>
      {ambiguityIssue.details.candidates.map((candidate) => (
        <option key={candidate.playerId} value={candidate.playerId}>{candidate.fullName}{candidate.clubOrFederation ? ` (${candidate.clubOrFederation})` : ""}</option>
      ))}
      <option value="CREATE">{vi.importExport.createNewPlayerOption}</option>
    </select>
  );
}
