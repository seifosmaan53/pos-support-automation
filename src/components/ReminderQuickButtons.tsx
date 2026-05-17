import { useAppStore } from "../services/appStore";
import {
  defaultFollowUp,
  defaultFollowUpForCurrent,
  inMinutes,
  nextShift,
  tomorrowMorning,
  whenPartsArrive,
} from "../services/reminderIntelligence";
import type { ExtractedDetails, TicketFields } from "../types/ticket";

/**
 * Phase 6 quick-action buttons used in the Ticket Form Helper and inside
 * History Inspect. Six buttons total per the spec:
 *
 *   • Create Reminder              — generic, due_at = default follow-up
 *   • Create Follow-up Reminder    — uses reminderIntelligence to prefill
 *   • Remind Tomorrow Morning      — tomorrow 9:00 AM local
 *   • Remind in 30 Minutes         — now + 30 min
 *   • Remind Next Shift            — afternoon shift today, else tomorrow AM
 *   • Remind When Parts Arrive     — 3 business days at 10:00 AM local
 *
 * The buttons are *advisory* — they create a reminder and surface a status
 * message; they don't open a modal. The user can edit later from the
 * Reminders page if they need to adjust title/message/due time.
 *
 * Each button is disabled (with an explanatory `title`) when there isn't
 * enough context to fill the prefilled message — that satisfies the
 * "no fake buttons; disable with clear reason" rule from the spec.
 */
export interface ReminderQuickButtonsProps {
  /** Optional override — used by the Inspect tab where the current store
   *  comes from the saved ticket, not the active workflow. */
  details?: Partial<ExtractedDetails>;
  fields?: Partial<TicketFields>;
  transcript?: string;
  ticketId?: string | null;
  /** Compact = smaller buttons (used in Inspect). */
  compact?: boolean;
}

export function ReminderQuickButtons(props: ReminderQuickButtonsProps) {
  const settings = useAppStore((s) => s.settings);
  const remindersEnabled = settings.reminderSettings.enableReminders;

  const storeDetails = useAppStore((s) => s.details);
  const storeFields = useAppStore((s) => s.ticketFields);
  const storeTranscript = useAppStore((s) => s.transcript);
  const currentTicketId = useAppStore((s) => s.currentTicketId);
  const create = useAppStore((s) => s.createReminder);

  const details = props.details ?? storeDetails;
  const fields = props.fields ?? storeFields;
  const transcript = props.transcript ?? storeTranscript;
  const ticketId = props.ticketId ?? currentTicketId;

  const cls = props.compact ? "btn-secondary text-xs" : "btn-secondary";
  const ghost = props.compact ? "btn-ghost text-xs" : "btn-ghost";

  const haveContext = !!(
    details.storeNumber ||
    details.issue ||
    fields.subject?.trim() ||
    transcript.trim()
  );
  const partContext = !!(details.partNeeded || fields.partRequest?.trim() || details.partRequest?.trim());
  const disabledReason = haveContext
    ? undefined
    : "Generate a ticket or extract details first so the reminder can prefill.";

  function plain(title: string, message: string, dueAt: string) {
    create({
      title,
      message,
      dueAt,
      storeNumber: details.storeNumber || "",
      ticketId: ticketId || null,
    });
  }

  function handleCreateGeneric() {
    const store = details.storeNumber ? `Store ${details.storeNumber}` : "Store Unknown";
    const issue =
      details.issue?.trim() ||
      fields.subject?.trim() ||
      details.errorMessage?.trim() ||
      "open ticket";
    plain(
      `Reminder for ${store}`,
      `Follow up on: ${issue}.`,
      defaultFollowUp(settings.reminderSettings),
    );
  }

  function handleCreateFollowUp() {
    const { title, message, dueAt } = defaultFollowUpForCurrent(
      { details, transcript, fields, ticketId },
      settings.reminderSettings,
    );
    plain(title, message, dueAt);
  }

  function handleTomorrowMorning() {
    const store = details.storeNumber ? `Store ${details.storeNumber}` : "Store Unknown";
    plain(
      `Follow up with ${store} tomorrow morning`,
      `Tomorrow morning: confirm whether ${store}'s issue was resolved.`,
      tomorrowMorning(),
    );
  }

  function handleIn30Min() {
    const store = details.storeNumber ? `Store ${details.storeNumber}` : "Store Unknown";
    plain(
      `Check back with ${store} in 30 minutes`,
      "Caller asked to be checked on in about 30 minutes.",
      inMinutes(30),
    );
  }

  function handleNextShift() {
    const store = details.storeNumber ? `Store ${details.storeNumber}` : "Store Unknown";
    plain(
      `Follow up with ${store} next shift`,
      "Pick this back up at the start of the next shift.",
      nextShift(),
    );
  }

  function handleWhenPartsArrive() {
    const partLabel =
      fields.partRequest?.trim() ||
      details.partRequest?.trim() ||
      "the replacement part";
    const store = details.storeNumber ? `Store ${details.storeNumber}` : "the store";
    plain(
      `Check ${partLabel} arrival for ${store}`,
      `Verify whether ${partLabel} arrived and ${store} is back to normal.`,
      whenPartsArrive(),
    );
  }

  if (!remindersEnabled) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
        Reminders are disabled in Settings.{" "}
        <a className="underline" href="/settings">
          Enable them
        </a>{" "}
        to use these quick buttons.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={cls}
        onClick={handleCreateGeneric}
        disabled={!haveContext}
        title={disabledReason ?? "Create a reminder using your default follow-up time."}
      >
        Create Reminder
      </button>
      <button
        type="button"
        className={cls}
        onClick={handleCreateFollowUp}
        disabled={!haveContext}
        title={
          disabledReason ??
          "Use AI suggestions to prefill the reminder title and message."
        }
      >
        Create Follow-up Reminder
      </button>
      <button
        type="button"
        className={ghost}
        onClick={handleTomorrowMorning}
        disabled={!haveContext}
        title={disabledReason ?? "Tomorrow at 9:00 AM."}
      >
        Remind Tomorrow Morning
      </button>
      <button
        type="button"
        className={ghost}
        onClick={handleIn30Min}
        disabled={!haveContext}
        title={disabledReason ?? "30 minutes from now."}
      >
        Remind in 30 Minutes
      </button>
      <button
        type="button"
        className={ghost}
        onClick={handleNextShift}
        disabled={!haveContext}
        title={disabledReason ?? "Afternoon today (4 PM) or tomorrow morning (9 AM), whichever is next."}
      >
        Remind Next Shift
      </button>
      <button
        type="button"
        className={ghost}
        onClick={handleWhenPartsArrive}
        disabled={!haveContext || !partContext}
        title={
          !haveContext
            ? disabledReason
            : partContext
              ? "Approx 3 business days from now."
              : "Mark a part as needed first to enable this reminder."
        }
      >
        Remind When Parts Arrive
      </button>
    </div>
  );
}
