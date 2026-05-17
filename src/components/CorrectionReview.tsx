import { useMemo, useState } from "react";
import type { CorrectionChange } from "../services/transcriptCorrector";

interface Props {
  /** Repair changes that were applied to the raw transcript. */
  changes: CorrectionChange[];
  /** The transcript as the corrector emitted it (with corrections applied). */
  cleanedTranscript: string;
  /** Replace the working transcript with the user's accepted/undone version. */
  onApplyResolved: (next: string) => void;
  /** Persist approved/undone categorization into the audit-trail store. */
  onResolve?: (
    approved: CorrectionChange[],
    undone: CorrectionChange[],
  ) => void;
}

type Resolution = "pending" | "approved" | "undone";

interface Row {
  index: number;
  from: string;
  to: string;
  source: CorrectionChange["source"];
  autoApply: boolean;
  resolution: Resolution;
}

const SOURCE_LABEL: Record<CorrectionChange["source"], string> = {
  domain: "Domain rule",
  "number-words": "Number-word",
  dictionary: "Dictionary",
};

/**
 * Show the changes the corrector applied so the user can keep them, or undo
 * specific ones before extraction. Auto-apply rules are pre-marked as
 * approved (they're already in the cleaned transcript). Non-auto rules show as
 * pending and require an explicit Approve click to count as accepted.
 */
export function CorrectionReview({ changes, cleanedTranscript, onApplyResolved, onResolve }: Props) {
  const initialRows = useMemo<Row[]>(
    () =>
      changes.map((c, i) => ({
        index: i,
        from: c.from,
        to: c.to,
        source: c.source,
        autoApply: c.autoApply,
        resolution: c.autoApply ? "approved" : "pending",
      })),
    [changes],
  );
  const [rows, setRows] = useState<Row[]>(initialRows);

  // Reset when the underlying changes array shifts (new transcript).
  if (rows.length !== initialRows.length) {
    setRows(initialRows);
  }

  if (changes.length === 0) {
    return null;
  }

  function setRowResolution(idx: number, resolution: Resolution) {
    setRows((prev) =>
      prev.map((r) => (r.index === idx ? { ...r, resolution } : r)),
    );
  }

  function applyToTranscript() {
    let next = cleanedTranscript;
    const approved: CorrectionChange[] = [];
    const undone: CorrectionChange[] = [];
    for (const r of rows) {
      const change: CorrectionChange = {
        from: r.from,
        to: r.to,
        source: r.source,
        autoApply: r.autoApply,
      };
      if (r.resolution === "undone") {
        undone.push(change);
        const idx = next.toLowerCase().indexOf(r.to.toLowerCase());
        if (idx >= 0) {
          next = next.slice(0, idx) + r.from + next.slice(idx + r.to.length);
        }
      } else if (r.resolution === "approved") {
        approved.push(change);
      }
    }
    onResolve?.(approved, undone);
    onApplyResolved(next);
  }

  const pending = rows.filter((r) => r.resolution === "pending").length;
  const undoneCount = rows.filter((r) => r.resolution === "undone").length;

  return (
    <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
            Transcript Repair Review
          </h3>
          <p className="text-xs text-blue-800 dark:text-blue-200">
            {changes.length} change{changes.length === 1 ? "" : "s"} applied.
            {pending > 0 && ` ${pending} pending approval.`}
            {undoneCount > 0 && ` ${undoneCount} marked to undo.`}
          </p>
        </div>
        {undoneCount > 0 && (
          <button
            type="button"
            className="rounded bg-blue-600 px-2 py-1 text-xs text-white"
            onClick={applyToTranscript}
            title="Restore the original wording for the rows you marked Undo"
          >
            Apply Undo Changes
          </button>
        )}
      </div>
      <ul className="space-y-1 text-xs">
        {rows.map((r) => {
          const undone = r.resolution === "undone";
          const approved = r.resolution === "approved";
          return (
            <li
              key={r.index}
              className={`flex flex-wrap items-center gap-2 rounded border bg-white px-2 py-1 dark:bg-slate-900 ${
                undone
                  ? "border-rose-300 dark:border-rose-700"
                  : approved
                    ? "border-emerald-300 dark:border-emerald-700"
                    : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {SOURCE_LABEL[r.source]}
              </span>
              <span className="text-slate-700 dark:text-slate-200">
                Corrected <span className="font-mono">"{r.from}"</span> to{" "}
                <span className="font-mono">"{r.to}"</span>
              </span>
              <div className="ml-auto flex items-center gap-1">
                {undone ? (
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs dark:border-slate-600"
                    onClick={() => setRowResolution(r.index, r.autoApply ? "approved" : "pending")}
                  >
                    Keep undo? Re-apply
                  </button>
                ) : (
                  <>
                    {!approved && (
                      <button
                        type="button"
                        className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white"
                        onClick={() => setRowResolution(r.index, "approved")}
                      >
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded border border-rose-300 px-2 py-0.5 text-xs text-rose-700 dark:border-rose-700 dark:text-rose-200"
                      onClick={() => setRowResolution(r.index, "undone")}
                      title="Restore the original wording for this change"
                    >
                      Undo
                    </button>
                  </>
                )}
                {approved && (
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-300">
                    ✓ approved
                  </span>
                )}
                {undone && (
                  <span className="text-[10px] text-rose-700 dark:text-rose-300">will undo</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
