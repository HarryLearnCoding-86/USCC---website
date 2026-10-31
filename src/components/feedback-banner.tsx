// src/components/feedback-banner.tsx
// Success or error message after an action. Errors use role="alert" so screen readers announce them.

/** A message to show, or null for none. */
export interface FeedbackMessage {
  isError: boolean;
  text: string;
}

/**
 * Feedback banner.
 *
 * @param props.feedbackMessage - Message to show; renders nothing when null.
 * @returns The banner or null.
 */
export function FeedbackBanner({ feedbackMessage }: { feedbackMessage: FeedbackMessage | null }) {
  if (!feedbackMessage) {
    return null;
  }
  return (
    <p
      role={feedbackMessage.isError ? "alert" : "status"}
      className={`rounded-md px-3 py-2 text-sm ${feedbackMessage.isError ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}
    >
      {feedbackMessage.text}
    </p>
  );
}
