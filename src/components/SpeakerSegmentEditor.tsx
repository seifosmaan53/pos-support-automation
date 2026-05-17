import { useEffect, useMemo, useState } from "react";
import {
  SPEAKER_LABEL_OPTIONS,
  speakerLabelText,
  type SpeakerLabel,
  type SpeakerSegment,
} from "../types/speaker";

interface Props {
  segments: SpeakerSegment[];
  onChange: (segmentId: string, speaker: SpeakerLabel) => void;
  onBulkChange?: (segmentIds: string[], speaker: SpeakerLabel) => void;
  onAlternate?: (firstSpeaker: SpeakerLabel) => void;
  onRerunExtraction?: () => void | Promise<void>;
  onSaveCorrections?: () => void;
  rerunDisabled?: boolean;
  rerunBusy?: boolean;
  /**
   * Optional: original (pre-repair) text per segment so the editor can show
   * "Original / Repaired" hints when transcript correction changed the text.
   * Keyed by trimmed segment text.
   */
  originalsByText?: Map<string, string>;
}

const SPEAKER_BG: Record<SpeakerLabel, string> = {
  tech_support: "bg-sky-50 border-sky-200 dark:bg-sky-900/20 dark:border-sky-800",
  store_employee: "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800",
  store_manager: "bg-violet-50 border-violet-200 dark:bg-violet-900/20 dark:border-violet-800",
  vendor: "bg-teal-50 border-teal-200 dark:bg-teal-900/20 dark:border-teal-800",
  customer: "bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-800",
  wrong_caller: "bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800",
  unknown: "bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700",
};

const SPEAKER_PILL: Record<SpeakerLabel, string> = {
  tech_support: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  store_employee: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  store_manager: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  vendor: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  customer: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  wrong_caller: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  unknown: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

import { explainLabel } from "../services/speakerDetector";

function reasonForLabel(seg: SpeakerSegment): string {
  return seg.reason ?? explainLabel(seg.speaker, seg.text, seg.userCorrected);
}

export function SpeakerSegmentEditor({
  segments,
  onChange,
  onBulkChange,
  onAlternate,
  onRerunExtraction,
  onSaveCorrections,
  rerunDisabled,
  rerunBusy,
  originalsByText,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Drop selections for IDs that no longer exist (re-detection regenerates IDs).
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(segments.map((s) => s.id));
      const next = new Set<string>();
      for (const id of prev) if (live.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [segments]);

  const allSelected = segments.length > 0 && selected.size === segments.length;
  const someSelected = selected.size > 0 && selected.size < segments.length;

  const correctedCount = useMemo(
    () => segments.filter((s) => s.userCorrected).length,
    [segments],
  );

  if (segments.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700">
        No speaker segments detected yet. Add a transcript above.
      </div>
    );
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(segments.map((s) => s.id)));
  }
  function selectNone() {
    setSelected(new Set());
  }

  function bulk(label: SpeakerLabel) {
    if (selected.size === 0 || !onBulkChange) return;
    onBulkChange(Array.from(selected), label);
    selectNone();
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-900/40">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 font-medium">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={() => (allSelected ? selectNone() : selectAll())}
            />
            {selected.size > 0
              ? `${selected.size} selected`
              : `Select all (${segments.length})`}
          </label>
          {onBulkChange && (
            <>
              <span className="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-600" aria-hidden />
              <span className="text-slate-500">Mark selected as:</span>
              <button
                type="button"
                className="rounded bg-sky-600 px-2 py-0.5 text-white disabled:opacity-50"
                disabled={selected.size === 0}
                onClick={() => bulk("tech_support")}
              >
                Tech Support
              </button>
              <button
                type="button"
                className="rounded bg-amber-600 px-2 py-0.5 text-white disabled:opacity-50"
                disabled={selected.size === 0}
                onClick={() => bulk("store_employee")}
              >
                Store Employee
              </button>
              <button
                type="button"
                className="rounded bg-violet-600 px-2 py-0.5 text-white disabled:opacity-50"
                disabled={selected.size === 0}
                onClick={() => bulk("store_manager")}
              >
                Store Manager
              </button>
              <button
                type="button"
                className="rounded bg-slate-500 px-2 py-0.5 text-white disabled:opacity-50"
                disabled={selected.size === 0}
                onClick={() => bulk("unknown")}
              >
                Unknown
              </button>
            </>
          )}
        </div>
        {onAlternate && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-slate-500">Alternate speakers starting with:</span>
            <button
              type="button"
              className="rounded border border-sky-300 px-2 py-0.5 text-sky-700 dark:border-sky-700 dark:text-sky-200"
              onClick={() => onAlternate("tech_support")}
              title="Apply alternating Tech Support / Store Employee / Tech Support… across all segments"
            >
              Tech Support
            </button>
            <button
              type="button"
              className="rounded border border-amber-300 px-2 py-0.5 text-amber-700 dark:border-amber-700 dark:text-amber-200"
              onClick={() => onAlternate("store_employee")}
              title="Apply alternating Store Employee / Tech Support / Store Employee… across all segments"
            >
              Store Employee
            </button>
            {correctedCount > 0 && (
              <span className="ml-auto text-emerald-700 dark:text-emerald-300">
                {correctedCount} corrected
              </span>
            )}
          </div>
        )}
        {(onRerunExtraction || onSaveCorrections) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
            {onSaveCorrections && (
              <button
                type="button"
                className="rounded border border-emerald-400 px-2 py-0.5 text-emerald-700 dark:border-emerald-700 dark:text-emerald-200"
                onClick={onSaveCorrections}
                title="Lock in speaker corrections (extraction will use these labels)"
              >
                Save Speaker Corrections
              </button>
            )}
            {onRerunExtraction && (
              <button
                type="button"
                className="rounded bg-emerald-600 px-2 py-0.5 text-white disabled:opacity-50"
                onClick={() => void onRerunExtraction()}
                disabled={rerunDisabled || rerunBusy}
                title="Re-run extraction with the corrected speaker labels"
              >
                {rerunBusy ? "Re-running…" : "Re-run Extraction"}
              </button>
            )}
          </div>
        )}
      </div>

      {segments.map((s) => {
        const isSel = selected.has(s.id);
        const original =
          s.originalText && s.originalText !== s.text
            ? s.originalText
            : originalsByText?.get(s.text.trim());
        const repaired = original && original !== s.text ? s.text : null;
        return (
          <div
            key={s.id}
            className={`rounded-md border p-3 text-sm ${SPEAKER_BG[s.speaker]} ${
              isSel ? "ring-2 ring-emerald-500" : ""
            }`}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                className="mr-1"
                checked={isSel}
                onChange={() => toggle(s.id)}
                aria-label="Select segment for bulk action"
              />
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${SPEAKER_PILL[s.speaker]}`}
              >
                {speakerLabelText(s.speaker)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  s.confidence === "high"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : s.confidence === "medium"
                      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200"
                      : "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                }`}
              >
                {s.confidence} confidence
              </span>
              {s.userCorrected && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                  ✓ Corrected
                </span>
              )}
              <select
                className="ml-auto rounded border border-slate-300 bg-white px-2 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                value={s.speaker}
                onChange={(e) => onChange(s.id, e.target.value as SpeakerLabel)}
                title="Correct the speaker label for this segment"
              >
                {SPEAKER_LABEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="mb-1 text-xs italic text-slate-500 dark:text-slate-400">
              {reasonForLabel(s)}
            </p>
            {repaired ? (
              <div className="space-y-0.5">
                <p className="text-xs text-slate-500 line-through dark:text-slate-500">
                  Original: {original}
                </p>
                <p className="leading-relaxed text-slate-700 dark:text-slate-200">
                  Repaired: {s.text}
                </p>
              </div>
            ) : (
              <p className="leading-relaxed text-slate-700 dark:text-slate-200">{s.text}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
