import { useEffect, useState } from "react";
import { useAppStore } from "../services/appStore";
import { Icon } from "./Icon";

/**
 * Phase 11A — Final Review card.
 *
 * Appears after `stopRecording` finishes the final whisper pass (or fails
 * cleanly). Shows the live and final transcripts side by side, lets the
 * user pick which one to commit (or edit before committing), and routes the
 * choice through the normal analysis flow.
 *
 * Hard rule: the live transcript never overwrites the final transcript
 * automatically. The user explicitly chooses. The original audio file and
 * the original transcripts (live segments, final pass text) all remain in
 * the store until `clearLiveCapture` is called by the chosen action.
 */
export function FinalReviewCard() {
  const liveCapture = useAppStore((s) => s.liveCapture);
  const acceptLiveTranscript = useAppStore((s) => s.acceptLiveTranscript);
  const acceptFinalTranscript = useAppStore((s) => s.acceptFinalTranscript);
  const acceptEditedTranscript = useAppStore((s) => s.acceptEditedTranscript);
  const rerunLiveSpeakerDetection = useAppStore(
    (s) => s.rerunLiveSpeakerDetection,
  );
  const rerunLiveExtraction = useAppStore((s) => s.rerunLiveExtraction);
  const saveUpdatedTranscript = useAppStore((s) => s.saveUpdatedTranscript);
  const clearLiveCapture = useAppStore((s) => s.clearLiveCapture);

  // Seed the edit draft with the final transcript when available, otherwise
  // the live transcript. Re-seed when the underlying texts change (e.g. the
  // final pass arrives a few seconds after the user opened the review).
  const [editDraft, setEditDraft] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing) return;
    setEditDraft(liveCapture.finalTranscript || liveCapture.liveTranscript || "");
  }, [liveCapture.finalTranscript, liveCapture.liveTranscript, editing]);

  if (liveCapture.status !== "review" && liveCapture.status !== "finalizing") {
    return null;
  }

  const finalizing = liveCapture.status === "finalizing";
  const finalText = liveCapture.finalTranscript;
  const liveText = liveCapture.liveTranscript;
  const finalErr = liveCapture.finalTranscriptError;
  const hasFinal = !!finalText.trim();
  const hasLive = !!liveText.trim();

  return (
    <section className="card space-y-3 border-emerald-200 dark:border-emerald-800/70">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Icon name="check" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Final Review</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              The recording is saved. Pick the transcript to analyze — the
              final full pass is more accurate, the live preview is faster.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost h-7 px-2 text-xs"
          onClick={clearLiveCapture}
          title="Hide this review card. The recording stays attached."
        >
          Dismiss review
        </button>
      </header>

      {finalizing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
          Running final transcription on the full recording…
        </div>
      )}

      {!finalizing && finalErr && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/30 dark:text-rose-200">
          {finalErr}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <TranscriptColumn
          title="Live Transcript"
          subtitle="Concatenated from per-chunk transcripts during the call."
          text={liveText}
          emptyLabel="Live preview was unavailable — no chunked transcripts."
          tone="rose"
        />
        <TranscriptColumn
          title="Final Transcript"
          subtitle="One whisper.cpp pass over the full saved recording."
          text={finalText}
          emptyLabel={
            finalErr ||
            (finalizing
              ? "Waiting for whisper.cpp…"
              : "Final transcript unavailable.")
          }
          tone="emerald"
        />
      </div>

      {editing && (
        <div className="space-y-2">
          <label className="label">Edited transcript</label>
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono leading-snug shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900/70"
            placeholder="Edit the transcript here before analyzing."
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                acceptEditedTranscript(editDraft);
                setEditing(false);
              }}
              disabled={!editDraft.trim()}
            >
              <Icon name="check" className="h-3.5 w-3.5" />
              Use edited transcript
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                saveUpdatedTranscript(editDraft);
                setEditing(false);
              }}
              disabled={!editDraft.trim()}
              title="Save the edit to the live transcript buffer without committing. You can then re-run extraction or speaker detection."
            >
              <Icon name="doc" className="h-3.5 w-3.5" />
              Save Updated Transcript
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setEditing(false)}
            >
              Cancel edit
            </button>
          </div>
        </div>
      )}

      {!editing && hasFinal && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100">
          <strong className="font-semibold">Recommended:</strong> Use Final
          Transcript. The final whisper.cpp pass runs over the full saved
          recording, so it has more context than the per-chunk live preview
          and is usually more accurate.
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary relative"
            onClick={acceptFinalTranscript}
            disabled={!hasFinal}
            title={hasFinal ? "Use the final transcript for analysis." : "Final transcript is empty."}
          >
            <Icon name="check" className="h-3.5 w-3.5" />
            Use Final Transcript
            {hasFinal && (
              <span className="ml-1 rounded-full bg-emerald-200 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
                Recommended
              </span>
            )}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={acceptLiveTranscript}
            disabled={!hasLive}
            title={hasLive ? "Use the live preview transcript for analysis." : "Live preview is empty."}
          >
            <Icon name="mic" className="h-3.5 w-3.5" />
            Use Live Transcript
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditDraft(finalText || liveText || "");
              setEditing(true);
            }}
            disabled={!hasFinal && !hasLive}
          >
            <Icon name="doc" className="h-3.5 w-3.5" />
            Edit Before Analyze
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={rerunLiveSpeakerDetection}
            disabled={liveCapture.segments.length === 0}
            title="Re-classify all non-corrected live segments using full context."
          >
            <Icon name="sparkle" className="h-3.5 w-3.5" />
            Re-run Speaker Detection
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={rerunLiveExtraction}
            disabled={!hasLive && !hasFinal}
            title="Refresh the Live Assist captured-detail cards from the current transcript."
          >
            <Icon name="sparkle" className="h-3.5 w-3.5" />
            Re-run Extraction
          </button>
        </div>
      )}
    </section>
  );
}

function TranscriptColumn({
  title,
  subtitle,
  text,
  emptyLabel,
  tone,
}: {
  title: string;
  subtitle: string;
  text: string;
  emptyLabel: string;
  tone: "rose" | "emerald";
}) {
  const tones = {
    rose: "border-rose-200 dark:border-rose-800/70",
    emerald: "border-emerald-200 dark:border-emerald-800/70",
  };
  return (
    <article className={`rounded-xl border bg-white p-3 dark:bg-slate-900/70 ${tones[tone]}`}>
      <header className="mb-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>
      </header>
      <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200/60 bg-slate-50/60 p-2 text-sm leading-snug text-slate-800 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-100">
        {text.trim() ? (
          text
        ) : (
          <span className="text-slate-400 dark:text-slate-500">{emptyLabel}</span>
        )}
      </div>
    </article>
  );
}
