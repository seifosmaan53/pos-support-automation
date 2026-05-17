/**
 * Phase 16C — Transcript Quality Card.
 *
 * Renders the verdict from `services/transcriptQuality.assessTranscriptQuality()`
 * with a clear status badge, the list of reasons, and action buttons that
 * map directly to the user's "what now?" options:
 *   • Re-record           — clears transcript + state, sends them back to record
 *   • Re-transcribe       — runs whisper again on the saved audio
 *   • Edit Transcript     — opens the Transcript Review page
 *   • Analyze Anyway      — bypasses the gate (output flagged review-required)
 *
 * The card is the single source of truth for "should the rest of New Ticket
 * run confidently?" — Live Assist + KB matching + ticket fields all read
 * the same verdict.
 */
import type { QualityVerdict, TranscriptQuality } from "../services/transcriptQuality";

const TONE: Record<
  TranscriptQuality,
  { badge: string; container: string; label: string }
> = {
  good: {
    badge: "bg-emerald-500 text-white",
    container:
      "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800/60 dark:bg-emerald-950/30",
    label: "Good",
  },
  usable: {
    badge: "bg-sky-500 text-white",
    container:
      "border-sky-200 bg-sky-50/70 dark:border-sky-800/60 dark:bg-sky-950/30",
    label: "Usable",
  },
  poor: {
    badge: "bg-amber-500 text-white",
    container:
      "border-amber-200 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/30",
    label: "Poor",
  },
  bad: {
    badge: "bg-red-600 text-white",
    container:
      "border-red-200 bg-red-50/70 dark:border-red-800/60 dark:bg-red-950/30",
    label: "Bad",
  },
};

interface TranscriptQualityCardProps {
  verdict: QualityVerdict;
  onReRecord?: () => void;
  onReTranscribe?: () => void;
  onEdit?: () => void;
  onAnalyzeAnyway?: () => void;
}

export function TranscriptQualityCard({
  verdict,
  onReRecord,
  onReTranscribe,
  onEdit,
  onAnalyzeAnyway,
}: TranscriptQualityCardProps) {
  const tone = TONE[verdict.quality];
  const showAnyway = !verdict.shouldAnalyze;

  return (
    <section className={`rounded-xl border p-3 text-sm ${tone.container}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.badge}`}
          >
            {tone.label}
          </span>
          <span className="font-medium">Transcript quality</span>
        </div>
        <div className="text-[11px] text-slate-600 dark:text-slate-400">
          {verdict.usefulWordCount} useful word(s)
          {verdict.artifactCount > 0 && (
            <> · {verdict.artifactCount} artifact(s)</>
          )}
          {verdict.artifactRatio > 0 && (
            <> · {(verdict.artifactRatio * 100).toFixed(0)}% artifact ratio</>
          )}
        </div>
      </div>

      <p className="mt-1.5">{verdict.warning}</p>

      {verdict.reasons.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-700 dark:text-slate-300">
          {verdict.reasons.slice(0, 5).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {onReRecord && (
          <button type="button" className="btn-ghost text-xs" onClick={onReRecord}>
            Re-record
          </button>
        )}
        {onReTranscribe && (
          <button type="button" className="btn-ghost text-xs" onClick={onReTranscribe}>
            Re-transcribe
          </button>
        )}
        {onEdit && (
          <button type="button" className="btn-ghost text-xs" onClick={onEdit}>
            Edit transcript
          </button>
        )}
        {showAnyway && onAnalyzeAnyway && (
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={onAnalyzeAnyway}
            title="Bypass the quality gate. Generated fields will be marked review-required."
          >
            Analyze anyway
          </button>
        )}
      </div>
    </section>
  );
}
