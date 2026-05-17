/**
 * Phase 11B — display-time chunk merging.
 *
 * Live whisper chunks are emitted on a fixed 5/10/15-second cadence. That
 * cadence cuts mid-sentence often enough that the viewer ends up with
 * fragments like:
 *
 *   Caller: I am calling
 *   Caller: from Store 1518.
 *
 * Two rows for a single utterance is hard to scan during a real call. This
 * module groups consecutive segments at *render time* — the underlying
 * LiveSegment data model is untouched, so segment-level edits, flag toggles
 * and speaker corrections still target the right rows. Each group is
 * presented as one merged row with concatenated text, the earliest
 * timestamp, and the union of segment IDs.
 *
 * Merging rules (all must hold):
 *   • same speaker label
 *   • both segments are "ready" and non-empty
 *   • same edited/important/wrong flag state (so visual treatment matches)
 *   • previous segment did NOT end with terminal punctuation, OR was very
 *     short (< 5 words) — a quick "Yes." should usually stand alone, but a
 *     fragment like "I am calling" should pull in the next chunk
 *
 * Overlap dedup: when whisper re-emits the end of the prior chunk at the
 * start of the next (common boundary hallucination), the joined text drops
 * the duplicate suffix.
 */

import type { LiveSegment } from "../types/live";

export interface SegmentGroup {
  /** The earliest segment in this group — used for the row's timestamp. */
  leadSegment: LiveSegment;
  /** All segment IDs the row represents (for edit / toggle propagation). */
  segmentIds: string[];
  /** All segments in their original order. */
  segments: LiveSegment[];
  /** Concatenated repaired text with boundary overlap removed. */
  mergedText: string;
  /** Concatenated raw text with boundary overlap removed. */
  mergedRawText: string;
  /** True if the group is more than one segment. */
  isMerged: boolean;
}

export function groupSegmentsForDisplay(segments: LiveSegment[]): SegmentGroup[] {
  const groups: SegmentGroup[] = [];
  let current: LiveSegment[] = [];

  for (const seg of segments) {
    if (current.length === 0) {
      current.push(seg);
      continue;
    }
    const prev = current[current.length - 1];
    if (canMergeContinuation(prev, seg)) {
      current.push(seg);
    } else {
      groups.push(toGroup(current));
      current = [seg];
    }
  }
  if (current.length > 0) groups.push(toGroup(current));
  return groups;
}

function toGroup(segments: LiveSegment[]): SegmentGroup {
  return {
    leadSegment: segments[0],
    segmentIds: segments.map((s) => s.id),
    segments,
    mergedText: joinWithoutOverlap(segments.map((s) => s.repairedText)),
    mergedRawText: joinWithoutOverlap(segments.map((s) => s.rawText)),
    isMerged: segments.length > 1,
  };
}

export function canMergeContinuation(
  prev: LiveSegment,
  next: LiveSegment,
): boolean {
  if (prev.speaker !== next.speaker) return false;
  if (prev.status !== "ready" || next.status !== "ready") return false;
  if (!prev.repairedText.trim() || !next.repairedText.trim()) return false;
  if (!!prev.textEdited !== !!next.textEdited) return false;
  if (!!prev.important !== !!next.important) return false;
  if (!!prev.wrongTranscription !== !!next.wrongTranscription) return false;

  const prevText = prev.repairedText.trim();
  const endsTerminal = /[.!?]["')\]]?$/.test(prevText);
  // A chunk that already ends in terminal punctuation is treated as a
  // complete utterance — never pull a continuation into it. This is the
  // single rule that decides everything: "Register 2." stands alone,
  // "I am calling" pulls in the next chunk.
  if (endsTerminal) return false;
  return true;
}

/**
 * Join texts while removing the largest suffix of the running text that is
 * a prefix of the next chunk. This is the whisper boundary-hallucination
 * fixer: a chunk that ends "I am calling" followed by "I am calling from
 * Store 1518" becomes "I am calling from Store 1518" instead of
 * "I am calling I am calling from Store 1518".
 *
 * Max overlap probe length capped at 60 chars to keep the operation cheap.
 */
export function joinWithoutOverlap(parts: string[]): string {
  let acc = "";
  for (const raw of parts) {
    const piece = raw.trim();
    if (!piece) continue;
    if (!acc) {
      acc = piece;
      continue;
    }
    const overlap = findOverlap(acc, piece, 60);
    if (overlap > 0) {
      acc = acc + " " + piece.slice(overlap).trimStart();
    } else {
      // Insert " " between fragments — but not between letters and a leading
      // punctuation mark like "," or "." in the next chunk.
      const sep = /^[,.;:!?]/.test(piece) ? "" : " ";
      acc = acc + sep + piece;
    }
  }
  return acc.replace(/\s+/g, " ").trim();
}

/**
 * Returns the length of the longest suffix of `a` that is also a prefix of
 * `b`, case-insensitive, bounded by `maxLen`. Skips matches shorter than 4
 * characters because short matches are usually coincidence ("the " ↔ "the ")
 * and not whisper hallucination.
 */
function findOverlap(a: string, b: string, maxLen: number): number {
  const aTail = a.slice(-maxLen).toLowerCase();
  const bHead = b.slice(0, maxLen).toLowerCase();
  for (let len = Math.min(aTail.length, bHead.length); len >= 4; len--) {
    if (aTail.slice(aTail.length - len) === bHead.slice(0, len)) {
      return len;
    }
  }
  return 0;
}
