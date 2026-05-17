/**
 * Phase 16D — chunk-overlap dedup.
 *
 * MediaRecorder + whisper.cpp chunked transcription has a notorious edge:
 * words at chunk boundaries fall in the gap, OR the encoder splits a word
 * across two clips so whisper transcribes the same word twice. With a 1.5–2 s
 * overlap between chunks (Phase 16D recording behavior), the second chunk's
 * head and the first chunk's tail typically share content.
 *
 * `dedupOverlap(prevTail, nextHead)` finds the largest shared suffix-prefix
 * between the two strings and returns the **non-overlapping head** of `next`.
 * The caller joins `prev + " " + result` to get a clean merged transcript.
 *
 * Conservative on purpose:
 *   • Match minimum 3 chars / 1 word — shorter matches cause false positives
 *     on common articles ("a", "the").
 *   • Match maximum 80 chars at the boundary — beyond that the overlap is
 *     usually coincidence, not a real shared seam.
 *   • Case-insensitive matching, but the original casing of `next` is
 *     preserved in the returned non-overlap fragment.
 *   • Punctuation-tolerant — "name?" and "name." match.
 */

const MIN_OVERLAP_CHARS = 3;
const MAX_OVERLAP_CHARS = 80;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Find the largest suffix of `prev` that is also a prefix of `next` (after
 * normalization). Returns the number of *characters* of `next` to drop.
 *
 * Returns 0 when no usable overlap exists.
 *
 * `prevEndsPunctuated` controls whether we also eat the immediate trailing
 * punctuation in `next`. When prev already terminates with [.!?,;:], the
 * punctuation that follows the duplicated word in next is itself part of
 * the duplication and should be dropped (otherwise we get "name? . Maria.").
 * When prev does NOT end with punctuation, the punctuation in next is new
 * content and must survive ("Pat" + "Pat. Thanks." → "Pat. Thanks.").
 */
export function findOverlapLength(
  prev: string,
  next: string,
  prevEndsPunctuated = /[.!?,;:]\s*$/.test(prev),
): number {
  const a = normalize(prev);
  const b = normalize(next);
  if (a.length === 0 || b.length === 0) return 0;
  const maxK = Math.min(a.length, b.length, MAX_OVERLAP_CHARS);
  // Walk longest-first so we accept the most aggressive match.
  for (let k = maxK; k >= MIN_OVERLAP_CHARS; k--) {
    if (a.slice(a.length - k) === b.slice(0, k)) {
      // Translate back to char-count in the *original* `next`. The
      // normalize step strips punctuation, so we walk the raw `next` until
      // we've consumed `k` alphanumeric characters.
      return charsToConsumeOriginal(next, k, prevEndsPunctuated);
    }
  }
  return 0;
}

function charsToConsumeOriginal(
  original: string,
  normalizedCount: number,
  eatTrailingPunctuation: boolean,
): number {
  let consumed = 0;
  let i = 0;
  while (i < original.length && consumed < normalizedCount) {
    const ch = original[i].toLowerCase();
    if (/[a-z0-9 ]/.test(ch)) consumed += 1;
    i += 1;
  }
  // Eat trailing punctuation only when prev already had terminal
  // punctuation — see the doc-comment on findOverlapLength.
  if (eatTrailingPunctuation) {
    while (i < original.length && /[.,;:!?]/.test(original[i])) i += 1;
  }
  // Eat trailing whitespace so the merged transcript doesn't double-space.
  while (i < original.length && /\s/.test(original[i])) i += 1;
  return i;
}

/**
 * Compute the chunk-aware merge of two transcribed strings. Returns the
 * full merged string with no double-counted overlap.
 *
 * `prev` may be the full live transcript so far (multi-sentence) — only
 * the tail is considered when matching. `next` is one fresh chunk.
 */
export function mergeChunkTexts(prev: string, next: string): string {
  const p = prev?.trim() ?? "";
  const n = next?.trim() ?? "";
  if (!p) return n;
  if (!n) return p;
  // Only look at the last 200 chars of prev — full-string matches are
  // expensive and the overlap will always live near the boundary.
  const tailWindow = p.slice(-200);
  const prevEndsPunctuated = /[.!?,;:]\s*$/.test(p);
  const drop = findOverlapLength(tailWindow, n, prevEndsPunctuated);
  const fragment = drop > 0 ? n.slice(drop) : n;
  if (!fragment.trim()) return p;
  // Separator selection:
  //   • if fragment starts with punctuation, no space — "Pat" + ". Thanks." = "Pat. Thanks."
  //   • if prev ends in whitespace already, no extra space
  //   • else a single space
  const startsWithPunct = /^[.,;:!?]/.test(fragment);
  const sep = startsWithPunct || /\s$/.test(p) ? "" : " ";
  return `${p}${sep}${fragment}`;
}

/**
 * Apply chunk-aware merging to an array of (already-cleaned) chunk strings
 * in arrival order. Useful for `buildLiveTranscript` style joins where the
 * inputs are individual chunks that may overlap each other.
 */
export function joinChunksWithOverlapDedup(chunks: string[]): string {
  let out = "";
  for (const chunk of chunks) {
    if (!chunk) continue;
    out = mergeChunkTexts(out, chunk);
  }
  return out;
}
