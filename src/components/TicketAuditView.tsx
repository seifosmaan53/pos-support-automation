import { useState } from "react";
import type { SavedTicket } from "../types/ticket";
import { speakerLabelText, type SpeakerLabel } from "../types/speaker";
import { CopyButton } from "./CopyButton";

interface Props {
  ticket: SavedTicket;
  onReanalyzeFromSavedSpeaker: () => void | Promise<void>;
  onReanalyzeFromOriginal: () => void | Promise<void>;
  onSaveSpeakerCorrections: () => void;
}

type ViewMode = "original" | "corrected" | "speaker" | "details" | "fields" | "summaries";

const VIEW_LABELS: Record<ViewMode, string> = {
  original: "Original Transcript",
  corrected: "Corrected Transcript",
  speaker: "Speaker Transcript",
  details: "Final Extracted Details",
  fields: "Final Ticket Fields",
  summaries: "Summary Versions",
};

const SPEAKER_PILL: Record<string, string> = {
  tech_support: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  store_employee: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  store_manager: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  vendor: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  customer: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  wrong_caller: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  unknown: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

/**
 * Build the "speaker transcript" shown to the user — each segment prefixed
 * with its label. Also used for Copy Speaker Transcript.
 */
function speakerTranscriptText(ticket: SavedTicket): string {
  return (ticket.speakerSegments ?? [])
    .map((s) => `${speakerLabelText(s.speakerLabel as SpeakerLabel)}: ${s.repairedText}`)
    .join("\n\n");
}

export function TicketAuditView({
  ticket,
  onReanalyzeFromSavedSpeaker,
  onReanalyzeFromOriginal,
  onSaveSpeakerCorrections,
}: Props) {
  const [view, setView] = useState<ViewMode>("speaker");
  const hasSpeakerTranscript = (ticket.speakerSegments?.length ?? 0) > 0;
  const speakerText = hasSpeakerTranscript ? speakerTranscriptText(ticket) : "";

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(VIEW_LABELS) as ViewMode[]).map((mode) => {
          const disabled =
            mode === "speaker"
              ? !hasSpeakerTranscript
              : mode === "corrected"
                ? !ticket.correctedTranscript && !ticket.transcript
                : false;
          return (
            <button
              key={mode}
              type="button"
              className={`rounded px-2 py-0.5 text-xs ${
                view === mode
                  ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900"
                  : "bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              onClick={() => !disabled && setView(mode)}
              disabled={disabled}
            >
              {VIEW_LABELS[mode]}
            </button>
          );
        })}
      </div>

      {view === "original" && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          {ticket.rawTranscript || ticket.transcript || "(empty)"}
        </pre>
      )}

      {view === "corrected" && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          {ticket.correctedTranscript || ticket.transcript || "(empty)"}
        </pre>
      )}

      {view === "speaker" &&
        (hasSpeakerTranscript ? (
          <div className="max-h-72 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            {ticket.speakerSegments.map((s) => (
              <div key={s.id} className="mb-2 last:mb-0">
                <div className="mb-0.5 flex items-center gap-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      SPEAKER_PILL[s.speakerLabel] ?? SPEAKER_PILL.unknown
                    }`}
                  >
                    {speakerLabelText(s.speakerLabel as SpeakerLabel)}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {s.confidence}
                    {s.userCorrected && " · ✓ corrected"}
                  </span>
                </div>
                {s.reason && (
                  <p className="mb-0.5 text-[10px] italic text-slate-500">{s.reason}</p>
                )}
                {s.originalText && s.originalText !== s.repairedText ? (
                  <>
                    <p className="text-[11px] text-slate-500 line-through">
                      Original: {s.originalText}
                    </p>
                    <p className="leading-relaxed text-slate-700 dark:text-slate-200">
                      Repaired: {s.repairedText}
                    </p>
                  </>
                ) : (
                  <p className="leading-relaxed text-slate-700 dark:text-slate-200">
                    {s.repairedText}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            No saved speaker transcript available for this ticket.
          </p>
        ))}

      {view === "details" && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          {JSON.stringify(ticket.details, null, 2)}
        </pre>
      )}

      {view === "fields" && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          {JSON.stringify(ticket.ticketFields, null, 2)}
        </pre>
      )}

      {view === "summaries" && (
        <div className="max-h-72 space-y-2 overflow-auto">
          {Object.entries(ticket.summaries ?? {}).map(([key, value]) => (
            <div
              key={key}
              className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">{key}</div>
              <p className="whitespace-pre-wrap text-xs">{value || "(empty)"}</p>
            </div>
          ))}
        </div>
      )}

      <AuditTrail ticket={ticket} />

      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
        <button
          type="button"
          className="rounded bg-slate-700 px-2 py-1 text-xs text-white"
          onClick={() => setView("speaker")}
          disabled={!hasSpeakerTranscript}
        >
          View Speaker Transcript
        </button>
        <CopyButton
          text={speakerText}
          label="Copy Speaker Transcript"
          className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-100"
        />
        <button
          type="button"
          className="rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50"
          onClick={() => void onReanalyzeFromSavedSpeaker()}
          disabled={!hasSpeakerTranscript}
          title="Use the saved speaker labels and corrected transcript"
        >
          Re-run from Saved Speaker Transcript
        </button>
        <button
          type="button"
          className="rounded bg-blue-600 px-2 py-1 text-xs text-white"
          onClick={() => void onReanalyzeFromOriginal()}
          title="Replay repair + speaker detection on the raw transcript"
        >
          Re-run from Original Transcript
        </button>
        <button
          type="button"
          className="rounded border border-emerald-400 px-2 py-1 text-xs text-emerald-700 dark:border-emerald-700 dark:text-emerald-200"
          onClick={onSaveSpeakerCorrections}
        >
          Save Updated Speaker Corrections
        </button>
      </div>
    </div>
  );
}

function AuditTrail({ ticket }: { ticket: SavedTicket }) {
  const approved = ticket.approvedCorrections ?? [];
  const undone = ticket.undoneCorrections ?? [];
  const nameCorrections = ticket.nameCorrectionsApplied ?? [];
  const speakerCorrections = (ticket.userCorrectedSpeakerSegments ?? []).map((s, i) => ({
    idx: i + 1,
    speaker: s.speakerLabel as SpeakerLabel,
    text: s.repairedText.slice(0, 60),
  }));
  if (
    approved.length === 0 &&
    undone.length === 0 &&
    nameCorrections.length === 0 &&
    speakerCorrections.length === 0
  ) {
    return null;
  }
  return (
    <details className="rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer font-semibold">Correction Audit Trail</summary>
      <div className="mt-2 space-y-2">
        {approved.length > 0 && (
          <div>
            <div className="font-semibold text-emerald-700 dark:text-emerald-300">Applied:</div>
            <ul className="ml-4 list-disc">
              {approved.map((c, i) => (
                <li key={i}>
                  {c.from} → {c.to}{" "}
                  <span className="text-[10px] text-slate-500">({c.source})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {undone.length > 0 && (
          <div>
            <div className="font-semibold text-rose-700 dark:text-rose-300">Undone:</div>
            <ul className="ml-4 list-disc">
              {undone.map((c, i) => (
                <li key={i}>
                  {c.from} → {c.to}{" "}
                  <span className="text-[10px] text-slate-500">({c.source})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {nameCorrections.length > 0 && (
          <div>
            <div className="font-semibold text-amber-700 dark:text-amber-300">Name hint:</div>
            <ul className="ml-4 list-disc">
              {nameCorrections.map((n, i) => (
                <li key={i}>
                  {n.detected} → {n.corrected}
                </li>
              ))}
            </ul>
          </div>
        )}
        {speakerCorrections.length > 0 && (
          <div>
            <div className="font-semibold text-violet-700 dark:text-violet-300">
              Speaker corrections:
            </div>
            <ul className="ml-4 list-disc">
              {speakerCorrections.map((s) => (
                <li key={s.idx}>
                  Segment {s.idx} marked as {speakerLabelText(s.speaker)} — "{s.text}…"
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
