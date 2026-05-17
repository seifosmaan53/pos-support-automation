import { useEffect, useState } from "react";

interface Props {
  /** Name as currently extracted from the transcript. */
  detectedName: string;
  /** Confidence notes from extraction — surfaced when name needs review. */
  confidenceNotes: string[];
  /** Apply the corrected name to the current details immediately. */
  onApply: (corrected: string) => void;
  /** Persist the detected→corrected mapping for future calls. */
  onSave: (detected: string, corrected: string) => void;
  /**
   * Existing saved correction for this detected form (if any), so the input
   * starts pre-filled and the user can confirm at a glance.
   */
  existingCorrection?: string;
}

/**
 * Surfaces the misheard caller name and lets the user fix it. Saving the
 * correction stores a `detected → corrected` mapping in settings so the next
 * call that surfaces the same misheard form gets the canonical name as a
 * hint. The "may need review" warning from extraction is preserved — saving
 * a hint is not a claim that the spelling is forever correct.
 */
export function NameCorrection({
  detectedName,
  confidenceNotes,
  onApply,
  onSave,
  existingCorrection,
}: Props) {
  const [draft, setDraft] = useState(existingCorrection ?? detectedName);

  useEffect(() => {
    setDraft(existingCorrection ?? detectedName);
  }, [detectedName, existingCorrection]);

  if (!detectedName.trim()) return null;

  const reviewNote = confidenceNotes.find((n) => /name/i.test(n));
  const noChange = draft.trim() === detectedName.trim() || draft.trim() === "";

  return (
    <section className="card space-y-2 border-amber-200 dark:border-amber-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Caller Name Correction</h3>
          <p className="text-xs text-slate-500">
            Voice recognition often mishears names (Kayla vs Kaitlyn). Save a
            correction here to use it as a hint on future calls — the review
            warning still appears when the underlying transcript is unclear.
          </p>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
        <div>
          <label className="label mb-1 text-xs">Detected</label>
          <input className="input text-sm" value={detectedName} readOnly />
        </div>
        <div>
          <label className="label mb-1 text-xs">Corrected</label>
          <input
            className="input text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Spell as the caller said it"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => onApply(draft.trim())}
            disabled={noChange}
            title="Update this ticket's caller name without saving as a hint"
          >
            Apply
          </button>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => {
              const corrected = draft.trim();
              if (!corrected || corrected === detectedName.trim()) return;
              onSave(detectedName.trim(), corrected);
              onApply(corrected);
            }}
            disabled={noChange}
            title="Save this correction as a hint for future calls"
          >
            Save Correction
          </button>
        </div>
      </div>
      {reviewNote && (
        <p className="text-xs text-amber-800 dark:text-amber-200">⚠ {reviewNote}</p>
      )}
      {existingCorrection && existingCorrection !== detectedName && (
        <p className="text-xs text-emerald-700 dark:text-emerald-300">
          A saved hint replaced the detected name with "{existingCorrection}".
        </p>
      )}
    </section>
  );
}
