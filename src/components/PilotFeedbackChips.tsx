/**
 * Phase 16 — quick-feedback chips for the pilot.
 *
 * Renders the 11 toggleable tags from the spec plus a one-line notes
 * field. Designed to be embedded after Save on the Ticket Form Helper
 * and inside the History inspect view so the user can attach a quick
 * verdict to every ticket without leaving the workflow.
 *
 * Only renders when there's a `ticketId` — pre-save it's a no-op so the
 * caller can mount it unconditionally.
 */
import { useEffect, useState } from "react";
import {
  FEEDBACK_TAG_LABELS,
  FEEDBACK_TAGS,
  getTicketFeedback,
  setTicketFeedbackNotes,
  toggleTicketTag,
  type FeedbackTag,
} from "../services/pilotMode";

interface PilotFeedbackChipsProps {
  ticketId: string | null;
  compact?: boolean;
}

export function PilotFeedbackChips({
  ticketId,
  compact,
}: PilotFeedbackChipsProps) {
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [notes, setNotes] = useState("");
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!ticketId) {
      setTags([]);
      setNotes("");
      return;
    }
    const fb = getTicketFeedback(ticketId);
    setTags(fb.tags);
    setNotes(fb.notes);
  }, [ticketId]);

  if (!ticketId) return null;

  function onToggle(tag: FeedbackTag) {
    if (!ticketId) return;
    const next = toggleTicketTag(ticketId, tag);
    setTags(next.tags);
    forceRender((n) => n + 1);
  }

  function onNotesBlur(value: string) {
    if (!ticketId) return;
    setTicketFeedbackNotes(ticketId, value);
  }

  return (
    <section
      className={`rounded-lg border border-slate-200 p-3 dark:border-slate-700 ${
        compact ? "text-xs" : "text-sm"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="font-semibold">Pilot feedback</div>
        <span className="text-[10px] text-slate-500">
          Lightweight tags — feeds the Pilot Week Report.
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {FEEDBACK_TAGS.map((t) => {
          const on = tags.includes(t);
          return (
            <button
              key={t}
              type="button"
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                on
                  ? t === "goodOutput"
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-amber-500 bg-amber-500 text-white"
                  : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
              onClick={() => onToggle(t)}
              title={FEEDBACK_TAG_LABELS[t]}
            >
              {FEEDBACK_TAG_LABELS[t]}
            </button>
          );
        })}
      </div>
      <textarea
        className="mt-2 w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
        placeholder="Optional notes — what was off, what would have helped, etc."
        rows={compact ? 1 : 2}
        defaultValue={notes}
        onBlur={(e) => onNotesBlur(e.target.value)}
      />
    </section>
  );
}
