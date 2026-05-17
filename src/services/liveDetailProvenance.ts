/**
 * Phase 11B — best-guess provenance for captured-detail cards.
 *
 * The analyzer returns extracted fields but not the segment that produced
 * each one. For live mode, finding the source is a useful UI win — "Caller
 * at 00:12" is far more navigable than just "Kaitlyn". Rather than thread
 * provenance through the analyzer, we approximate it: walk the live
 * segments in time order and return the FIRST one whose text contains the
 * captured value.
 *
 * Imperfect by design — handles most cases right, fails gracefully:
 *   • A store number "1518" might appear in multiple segments; the first
 *     hit is the most likely source.
 *   • Caller name match is case-insensitive and word-boundary-anchored so
 *     "Kate" doesn't match "Kaitlyn".
 *   • Returns null when no segment contains the value at all (e.g. the
 *     analyzer matched a number-word like "Register 1" that the transcript
 *     spells out as "register one").
 */

import type { LiveSegment } from "../types/live";

export interface DetailSource {
  segmentId: string;
  audioOffsetMs: number;
  speakerLabel: LiveSegment["speaker"];
}

/**
 * Find the earliest live segment that contains the given value as a token.
 * Returns null if no segment in the array matches.
 */
export function findSourceForValue(
  value: string,
  segments: LiveSegment[],
): DetailSource | null {
  const v = value.trim();
  if (!v) return null;
  // Escape regex metacharacters, then anchor to word boundaries when the
  // value starts/ends with an alphanumeric character.
  const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startsWord = /[A-Za-z0-9]/.test(v.charAt(0));
  const endsWord = /[A-Za-z0-9]/.test(v.charAt(v.length - 1));
  const pattern = new RegExp(
    `${startsWord ? "\\b" : ""}${escaped}${endsWord ? "\\b" : ""}`,
    "i",
  );
  for (const seg of segments) {
    if (seg.status !== "ready") continue;
    if (seg.wrongTranscription) continue;
    const haystack = (seg.repairedText || seg.rawText || "").trim();
    if (!haystack) continue;
    if (pattern.test(haystack)) {
      return {
        segmentId: seg.id,
        audioOffsetMs: seg.audioOffsetMs,
        speakerLabel: seg.speaker,
      };
    }
  }
  return null;
}

/**
 * Format a source pointer as the spec's "Caller at 00:12" / "Tech Support
 * at 00:01" style label. Non-tech speakers are flattened to "Caller" to
 * match the live conversation view's labelling convention.
 */
export function formatSourceLabel(source: DetailSource): string {
  const min = Math.floor(source.audioOffsetMs / 60000);
  const sec = Math.floor((source.audioOffsetMs % 60000) / 1000);
  const ts = `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  const who =
    source.speakerLabel === "tech_support"
      ? "Tech Support"
      : source.speakerLabel === "vendor"
        ? "Vendor"
        : source.speakerLabel === "wrong_caller"
          ? "Wrong Caller"
          : "Caller";
  return `${who} at ${ts}`;
}
