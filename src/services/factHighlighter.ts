/**
 * Phase 11B — fact phrase highlighter for Live Conversation.
 *
 * Takes one repaired-transcript string and returns an array of span objects
 * `{ kind: "text" | "fact", text }` that the renderer can map to spans with
 * different styling. Highlights the high-value retail support phrases the
 * spec lists:
 *   • Store NNN  (and "store NNN")
 *   • Register N
 *   • hardware failure
 *   • power drain
 *   • back to normal
 *   • no replacement (needed)
 *   • PCF / BOS / Inseego / VeriFone (brand tokens)
 *
 * The matcher is non-overlapping and case-insensitive. When two patterns
 * match the same range, the longer match wins (so "Store 1518" beats a
 * naked "1518" hit).
 */

export interface FactSpan {
  kind: "text" | "fact";
  text: string;
}

// Order matters: more-specific patterns first. The walker uses non-overlapping
// matching, so once a range is claimed by an earlier pattern, later patterns
// skip it.
const FACT_PATTERNS: RegExp[] = [
  /\bstore\s+\d{1,5}\b/gi,
  /\bregister\s+\d{1,3}\b/gi,
  /\bhardware\s+failure\b/gi,
  /\bpower\s+drain\b/gi,
  /\bback\s+to\s+normal\b/gi,
  /\bno\s+replacement(?:\s+(?:is\s+)?needed)?\b/gi,
  /\b(?:pcf|bos|inseego|veri\s*fone|com\s+services|pro\s+services)\b/gi,
];

interface Range {
  start: number;
  end: number;
}

export function highlightFactPhrases(text: string): FactSpan[] {
  if (!text) return [];

  // Collect non-overlapping fact ranges from all patterns.
  const ranges: Range[] = [];
  for (const re of FACT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const r = { start: m.index, end: m.index + m[0].length };
      if (!overlapsAny(r, ranges)) ranges.push(r);
      // Defensive: advance lastIndex when match was zero-length (shouldn't
      // happen with these patterns, but cheap insurance).
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  // Walk the text producing alternating "text" and "fact" spans.
  const out: FactSpan[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, r.start) });
    }
    out.push({ kind: "fact", text: text.slice(r.start, r.end) });
    cursor = r.end;
  }
  if (cursor < text.length) {
    out.push({ kind: "text", text: text.slice(cursor) });
  }
  return out;
}

function overlapsAny(r: Range, others: Range[]): boolean {
  for (const o of others) {
    if (r.start < o.end && o.start < r.end) return true;
  }
  return false;
}
