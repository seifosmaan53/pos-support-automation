import { useMemo, useState } from "react";
import { useAppStore } from "../services/appStore";
import { ticketFeedbackStore } from "../services/ticketFeedbackStore";
import {
  CORRECTABLE_FIELDS,
  type CorrectableField,
  type ResolutionStatus,
} from "../types/feedback";
import type { TicketFields } from "../types/ticket";
import { useNavigate } from "react-router-dom";
import { AddToKnowledgeButton } from "./AddToKnowledgeButton";

/**
 * Phase 4 correction toolbar. Lives at the top of the Ticket Form Helper
 * page (or any place the user is editing generated fields). Provides:
 *
 *   • Save Correction         — diff the editable subject/description/
 *     resolution/etc. against the AI-generated baseline and persist as a
 *     `ticket_feedback` row.
 *   • Save as Style Example   — capture the current edited fields + raw
 *     transcript into the style_examples table for future generations.
 *   • Mark AI Missed Detail   — small inline form: what was missed,
 *     correct value, which field. Saved as `what_ai_missed` plus an
 *     optional FieldCorrection on the same row.
 *   • Mark Resolution Worked  — tri-state pill (worked / did-not-work /
 *     unknown). Persisted on the same feedback row.
 *   • Add to Knowledge Base   — disabled with a tooltip until Phase 5.
 *
 * Buttons that can't act are *disabled* with a clear `title` reason —
 * never silently no-op'd.
 */
export function CorrectionToolbar() {
  const fields = useAppStore((s) => s.ticketFields);
  const currentTicketId = useAppStore((s) => s.currentTicketId);
  const recordCorrection = useAppStore((s) => s.recordFieldCorrection);
  const recordAIMissed = useAppStore((s) => s.recordAIMissed);
  const setResolution = useAppStore((s) => s.setResolutionStatus);
  const saveStyleExample = useAppStore((s) => s.saveCurrentTicketAsStyleExample);
  const saveTicket = useAppStore((s) => s.saveCurrentTicket);
  const setStatus = useAppStore((s) => s.setStatus);
  const navigate = useNavigate();

  const [missedOpen, setMissedOpen] = useState(false);
  const [missedField, setMissedField] = useState<CorrectableField>("callerName");
  const [missedNote, setMissedNote] = useState("");
  const [missedValue, setMissedValue] = useState("");

  // Refresh tick so Save Correction's "since save" indicator updates after
  // we write a new feedback row.
  const [refreshTick, setRefresh] = useState(0);
  const latestFeedback = useMemo(
    () => (currentTicketId ? ticketFeedbackStore.latestForTicket(currentTicketId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTicketId, refreshTick],
  );

  const hasContent = !!fields.subject.trim() || !!fields.description.trim();
  const resolutionStatus: ResolutionStatus = latestFeedback?.resolutionWorked ?? "unknown";

  function handleSaveCorrection() {
    if (!currentTicketId) {
      const saved = saveTicket();
      if (!saved) return;
    }
    // Diff the AI baseline (the latest feedback's snapshot, or the current
    // generated fields if none yet) against the editable fields. Each
    // changed field becomes its own FieldCorrection — multiple fields per
    // call are supported because the toolbar runs against the whole form.
    const id = useAppStore.getState().currentTicketId;
    if (!id) return;
    const baseline = ticketFeedbackStore.latestForTicket(id);
    const baselineFields: Pick<TicketFields, "subject" | "description" | "resolution" | "partRequest" | "additionalComments"> =
      {
        subject: baseline?.originalSubject || fields.subject,
        description: baseline?.originalDescription || fields.description,
        resolution: baseline?.originalResolution || fields.resolution,
        partRequest: fields.partRequest,
        additionalComments: fields.additionalComments,
      };
    const pairs: [CorrectableField, string, string][] = [
      ["subject", baselineFields.subject, fields.subject],
      ["description", baselineFields.description, fields.description],
      ["resolution", baselineFields.resolution, fields.resolution],
      ["partRequest", baselineFields.partRequest, fields.partRequest],
      ["additionalComments", baselineFields.additionalComments, fields.additionalComments],
    ];
    let saved = 0;
    for (const [field, before, after] of pairs) {
      if (before === after) continue;
      const result = recordCorrection(field, before, after);
      if (result) saved++;
    }
    if (saved === 0) {
      setStatus({
        kind: "info",
        message:
          "Nothing to save — the editable fields match the AI baseline. Edit a field first, then click Save Correction.",
      });
    }
    setRefresh((n) => n + 1);
  }

  function handleSaveStyleExample() {
    const ex = saveStyleExample();
    if (ex) setRefresh((n) => n + 1);
  }

  function handleSubmitMissed() {
    if (!missedNote.trim() && !missedValue.trim()) {
      setStatus({
        kind: "warning",
        message: "Type what the AI missed or the correct value first.",
      });
      return;
    }
    recordAIMissed(missedNote, missedField, missedValue || undefined);
    setMissedNote("");
    setMissedValue("");
    setMissedOpen(false);
    setRefresh((n) => n + 1);
  }

  function handleResolution(status: ResolutionStatus) {
    setResolution(status);
    setRefresh((n) => n + 1);
  }

  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Correction Feedback</h2>
          <p className="text-xs text-slate-500">
            Saved corrections train style examples for future similar tickets. None of this
            leaves your machine.
          </p>
        </div>
        {latestFeedback && (
          <span className="text-[11px] text-slate-500">
            {latestFeedback.correctedFields.length} correction(s) on this ticket so far
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={handleSaveCorrection}
          disabled={!hasContent}
          title={
            hasContent
              ? "Diff edited fields against the AI baseline and save the corrections."
              : "Generate a ticket first."
          }
        >
          Save Correction
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={handleSaveStyleExample}
          disabled={!hasContent}
          title={
            hasContent
              ? "Capture the current ticket as a Style Example for future similar tickets."
              : "Generate a ticket first."
          }
        >
          Save as Style Example
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setMissedOpen((v) => !v)}
          disabled={!hasContent}
          title={hasContent ? "Record an 'AI missed: ...' note." : "Generate a ticket first."}
        >
          {missedOpen ? "Hide Missed-Detail Form" : "Mark AI Missed Detail"}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <span className="text-[11px] uppercase text-slate-500">Resolution:</span>
          <ResolutionPill
            label="Worked"
            value="worked"
            current={resolutionStatus}
            onClick={handleResolution}
          />
          <ResolutionPill
            label="Did Not Work"
            value="did-not-work"
            current={resolutionStatus}
            onClick={handleResolution}
          />
          <ResolutionPill
            label="Unknown"
            value="unknown"
            current={resolutionStatus}
            onClick={handleResolution}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => navigate("/style-examples")}
          title="Open the Style Examples page to review or edit captured examples."
        >
          Open Style Examples
        </button>
        <AddToKnowledgeButton
          className="btn-ghost text-xs"
          disabledReason={
            hasContent
              ? undefined
              : "Generate a ticket first so there's something to capture."
          }
          ticketId={currentTicketId ?? undefined}
        />
      </div>

      {missedOpen && (
        <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="text-xs">
              Field affected
              <select
                className="input mt-1 w-full"
                value={missedField}
                onChange={(e) => setMissedField(e.target.value as CorrectableField)}
              >
                {CORRECTABLE_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Correct value
              <input
                className="input mt-1 w-full"
                value={missedValue}
                onChange={(e) => setMissedValue(e.target.value)}
                placeholder="e.g. Kaitlyn"
              />
            </label>
          </div>
          <label className="text-xs">
            What did the AI miss?
            <textarea
              className="input mt-1 w-full"
              rows={2}
              value={missedNote}
              onChange={(e) => setMissedNote(e.target.value)}
              placeholder="e.g. Caller name was Kaitlyn but the AI guessed Kayla."
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={handleSubmitMissed}
              disabled={!missedNote.trim() && !missedValue.trim()}
            >
              Save Missed Detail
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                setMissedOpen(false);
                setMissedNote("");
                setMissedValue("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ResolutionPill({
  label,
  value,
  current,
  onClick,
}: {
  label: string;
  value: ResolutionStatus;
  current: ResolutionStatus;
  onClick: (v: ResolutionStatus) => void;
}) {
  const active = current === value;
  const tone =
    value === "worked"
      ? active
        ? "bg-emerald-600 text-white"
        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : value === "did-not-work"
        ? active
          ? "bg-red-600 text-white"
          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
        : active
          ? "bg-slate-700 text-white"
          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
  return (
    <button
      type="button"
      className={`rounded px-2 py-0.5 text-xs ${tone}`}
      onClick={() => onClick(value)}
      title={`Mark resolution: ${label}`}
    >
      {label}
    </button>
  );
}
