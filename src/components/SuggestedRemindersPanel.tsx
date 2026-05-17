import { useMemo, useState } from "react";
import { useAppStore } from "../services/appStore";
import { suggestRemindersForCurrent } from "../services/reminderIntelligence";
import { formatDateTime } from "../utils/formatDate";
import type { ExtractedDetails, TicketFields } from "../types/ticket";
import type { ReminderSuggestion } from "../types/reminder";

/**
 * Phase 6 panel that surfaces auto-detected reminder suggestions on the
 * Ticket Form Helper page. For each suggestion it renders the title, the
 * suggested message, the suggested due time, the reason it surfaced, and
 * Create / Dismiss buttons.
 *
 * The panel never auto-creates anything — even when
 * `reminderSettings.autoCreateFromTranscript` is on, that behaviour is
 * implemented elsewhere (next phase if/when wired); this panel always asks
 * for confirmation. Per-session dismissals are tracked in component state
 * so a noisy ticket doesn't keep nagging after the user has decided.
 *
 * Empty / no-suggestions: render nothing — the form already has plenty of
 * sections and adding a "no reminders yet" placeholder would be visual
 * clutter. The Quick Buttons component below the panel gives the user the
 * manual path either way.
 */
export interface SuggestedRemindersPanelProps {
  details?: Partial<ExtractedDetails>;
  fields?: Partial<TicketFields>;
  transcript?: string;
  ticketId?: string | null;
}

export function SuggestedRemindersPanel(props: SuggestedRemindersPanelProps) {
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

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<Set<string>>(new Set());

  const suggestions: ReminderSuggestion[] = useMemo(() => {
    if (!remindersEnabled) return [];
    try {
      return suggestRemindersForCurrent({ details, transcript, fields, ticketId });
    } catch {
      return [];
    }
  }, [remindersEnabled, details, transcript, fields, ticketId]);

  const visible = suggestions.filter((s) => !dismissed.has(s.key));

  if (!remindersEnabled || visible.length === 0) return null;

  function handleCreate(s: ReminderSuggestion) {
    create({
      title: s.title,
      message: s.message,
      dueAt: s.dueAt,
      storeNumber: details.storeNumber || "",
      ticketId: ticketId || null,
    });
    // Mark created so we can show a soft "✓ Created" indicator. We don't
    // remove the card outright — the user might want to reference the same
    // suggestion again before leaving the page.
    setCreated((prev) => new Set(prev).add(s.key));
  }

  function handleDismiss(s: ReminderSuggestion) {
    setDismissed((prev) => new Set(prev).add(s.key));
  }

  return (
    <section className="card space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Suggested Reminders</h2>
          <p className="text-xs text-slate-500">
            Detected from the ticket details and transcript. Verify before saving.
          </p>
        </div>
        <span className="text-[11px] text-slate-500">
          {visible.length} suggestion{visible.length === 1 ? "" : "s"}
        </span>
      </header>

      <ul className="space-y-2">
        {visible.map((s) => {
          const isCreated = created.has(s.key);
          return (
            <li
              key={s.key}
              className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{s.title}</span>
                {isCreated && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                    ✓ Reminder created
                  </span>
                )}
              </div>
              <p className="mt-1 text-slate-700 dark:text-slate-200">{s.message}</p>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>
                  Suggested due: <strong>{formatDateTime(s.dueAt)}</strong>
                </span>
                <span className="italic">{s.reason}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => handleCreate(s)}
                  disabled={isCreated}
                  title={
                    isCreated
                      ? "Reminder already created — open the Reminders page to edit."
                      : "Save this suggestion as a reminder."
                  }
                >
                  {isCreated ? "Created" : "Create Reminder"}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => handleDismiss(s)}
                  title="Hide this suggestion for the rest of the session."
                >
                  Dismiss Suggestion
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
