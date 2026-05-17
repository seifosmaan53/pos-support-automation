import { confidenceColor, confidenceLabel, type SelfReviewResult } from "../types/confidence";

interface Props {
  review: SelfReviewResult;
  onRerun?: () => void;
}

const TONE_BG: Record<string, string> = {
  emerald:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  amber:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
  orange:
    "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200",
  red:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200",
};

const FIELD_LEVEL_PILL: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  low: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  missing: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

export function SelfReviewBanner({ review, onRerun }: Props) {
  if (review.fields.length === 0) return null;
  const tone = TONE_BG[confidenceColor(review.overall)];

  return (
    <section className={`rounded-md border p-3 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">
            Overall: {confidenceLabel(review.overall)}
          </div>
          <div className="text-xs opacity-80">
            {review.reviewRecommended
              ? "Review recommended before copying."
              : "All required fields look good."}
          </div>
        </div>
        {onRerun && (
          <button
            onClick={onRerun}
            className="rounded-md border border-current px-2 py-1 text-xs hover:bg-white/40 dark:hover:bg-black/20"
            title="Re-run self-review with the current details and speaker labels"
          >
            Re-run Self-Review
          </button>
        )}
      </div>

      {review.flags.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {review.flags.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {review.fields.map((f) => (
          <div key={f.field} className="flex items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${FIELD_LEVEL_PILL[f.level]}`}
            >
              {f.field}: {f.level}
            </span>
            <span className="opacity-70">{f.reason}</span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] opacity-60">
        This is a best-effort review, not a guarantee. Verify before submitting.
      </p>
    </section>
  );
}
