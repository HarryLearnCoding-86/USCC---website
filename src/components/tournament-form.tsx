// src/components/tournament-form.tsx
// Create / edit form for a tournament's details and colours (SRS-TOUR-01, 02, 04). Warns live when a colour
// gives white text a contrast below 4.5:1 (SRS-TOUR-03); the warning does not block saving.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { vi } from "@/i18n/vi";
import { readApiErrorMessage, sendJsonMutation } from "@/client/api-request";
import { HEX_COLOR_PATTERN, hasLowContrastWithWhiteText } from "@/server/domain/tournament-rules";
import { FeedbackBanner, type FeedbackMessage } from "@/components/feedback-banner";

/** Form values; dates as "YYYY-MM-DD", colours as "#rrggbb". */
export interface TournamentFormValues {
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  organizer: string;
  roundsCount: number;
  timezone: string;
  primaryColor: string;
  secondaryColor: string;
}

/** Defaults for a new tournament. */
export const EMPTY_TOURNAMENT_FORM_VALUES: TournamentFormValues = {
  name: "",
  startDate: "",
  endDate: "",
  venue: "",
  organizer: "USCC",
  roundsCount: 7,
  timezone: "Asia/Ho_Chi_Minh",
  primaryColor: "#1d4ed8",
  secondaryColor: "#1e3a8a",
};

/**
 * Tournament form.
 *
 * @param props.initialValues - Values to start from.
 * @param props.tournamentId - Set when editing; omitted when creating.
 * @returns The form element.
 */
export function TournamentForm({ initialValues, tournamentId }: { initialValues: TournamentFormValues; tournamentId?: string }) {
  const router = useRouter();
  const [formValues, setFormValues] = useState(initialValues);
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<TFieldName extends keyof TournamentFormValues>(fieldName: TFieldName, fieldValue: TournamentFormValues[TFieldName]) {
    setFormValues((currentValues) => ({ ...currentValues, [fieldName]: fieldValue }));
  }

  async function submitTournament(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setIsSubmitting(true);
    setFeedbackMessage(null);
    try {
      const result = await sendJsonMutation<{ tournament: { id: string } }>(
        tournamentId ? "PATCH" : "POST",
        tournamentId ? `/api/tournaments/${tournamentId}` : "/api/tournaments",
        formValues,
      );
      if (!result.isOk) {
        setFeedbackMessage({ isError: true, text: readApiErrorMessage(result.body, vi.common.error) });
        return;
      }
      if (tournamentId) {
        setFeedbackMessage({ isError: false, text: vi.tournaments.updateSuccess });
        router.refresh();
      } else {
        router.push(`/tournaments/${result.body.tournament.id}/settings`);
      }
    } catch {
      setFeedbackMessage({ isError: true, text: vi.apiErrors.serverError });
    } finally {
      setIsSubmitting(false);
    }
  }

  const contrastWarnings = [
    { colorValue: formValues.primaryColor, colorLabel: vi.tournaments.primaryColorLabel },
    { colorValue: formValues.secondaryColor, colorLabel: vi.tournaments.secondaryColorLabel },
  ].filter(({ colorValue }) => HEX_COLOR_PATTERN.test(colorValue) && hasLowContrastWithWhiteText(colorValue));

  const inputClassName = "min-h-[44px] rounded-md border border-gray-300 px-3";
  const textField = (fieldName: "name" | "venue" | "organizer" | "timezone", label: string, isRequired = false) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        name={fieldName}
        value={formValues[fieldName]}
        onChange={(changeEvent) => updateField(fieldName, changeEvent.target.value)}
        className={inputClassName}
        required={isRequired}
      />
    </label>
  );

  return (
    <form onSubmit={submitTournament} className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">
      {textField("name", vi.tournaments.nameLabel, true)}
      {textField("venue", vi.tournaments.venueLabel)}
      <label className="flex flex-col gap-1 text-sm">
        {vi.tournaments.startDateLabel}
        <input name="startDate" type="date" value={formValues.startDate} onChange={(changeEvent) => updateField("startDate", changeEvent.target.value)} className={inputClassName} required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {vi.tournaments.endDateLabel}
        <input name="endDate" type="date" value={formValues.endDate} onChange={(changeEvent) => updateField("endDate", changeEvent.target.value)} className={inputClassName} required />
      </label>
      {textField("organizer", vi.tournaments.organizerLabel)}
      <label className="flex flex-col gap-1 text-sm">
        {vi.tournaments.roundsCountLabel}
        <input
          name="roundsCount"
          type="number"
          min={1}
          max={20}
          value={formValues.roundsCount}
          onChange={(changeEvent) => updateField("roundsCount", Number(changeEvent.target.value))}
          className={inputClassName}
          required
        />
      </label>
      {textField("timezone", vi.tournaments.timezoneLabel, true)}
      <div className="flex gap-4">
        {(["primaryColor", "secondaryColor"] as const).map((fieldName) => (
          <label key={fieldName} className="flex flex-col gap-1 text-sm">
            {fieldName === "primaryColor" ? vi.tournaments.primaryColorLabel : vi.tournaments.secondaryColorLabel}
            <input
              name={fieldName}
              type="color"
              value={formValues[fieldName]}
              onChange={(changeEvent) => updateField(fieldName, changeEvent.target.value)}
              className="h-11 w-20 rounded border border-gray-300"
            />
          </label>
        ))}
      </div>
      {contrastWarnings.map(({ colorLabel }) => (
        <p key={colorLabel} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2">
          {vi.tournaments.lowContrastWarning(colorLabel)}
        </p>
      ))}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FeedbackBanner feedbackMessage={feedbackMessage} />
        <button type="submit" disabled={isSubmitting} className="btn-primary min-h-[44px] self-start">
          {tournamentId ? vi.tournaments.saveButton : vi.tournaments.createButton}
        </button>
      </div>
    </form>
  );
}
