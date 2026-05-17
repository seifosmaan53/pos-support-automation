/**
 * Phase 10B+C: User-editable extraction patterns.
 *
 * Each pattern targets a specific field kind (store, caller, register, error)
 * and runs INSIDE the analyzer before the built-in patterns. Two sources:
 *   - "manual": user typed the regex in Settings → Extraction Patterns
 *   - "learned": auto-derived from a Live-Assist inline answer the user gave
 *
 * The bank is persistent (localStorage for v1) so patterns accumulate across
 * sessions. Phase B's "learn from every call" is implemented by adding a new
 * "learned" pattern every time the user answers a Missing alert.
 */
import type { TicketResult } from "./ticket";

export type ExtractionPatternKind =
  | "storeNumber"
  | "callerName"
  | "registerNumber"
  | "errorMessage"
  | "result";

export const EXTRACTION_KIND_LABELS: Record<ExtractionPatternKind, string> = {
  storeNumber: "Store Number",
  callerName: "Caller Name",
  registerNumber: "Register Number",
  errorMessage: "Error Message",
  result: "Result",
};

export interface ExtractionPattern {
  id: string;
  kind: ExtractionPatternKind;
  /** User-friendly name, shown in Settings. */
  label: string;
  /** Raw regex source. Compiled with `new RegExp(pattern, flags)`. */
  pattern: string;
  /** Regex flags. Always includes "i" by default. */
  flags: string;
  /** Which capture group has the extracted value (1-indexed). */
  captureGroup: number;
  /** Disable without deleting — useful for debugging false positives. */
  enabled: boolean;
  /**
   * "manual" patterns came from Settings → Extraction Patterns.
   * "learned" patterns came from a Live-Assist inline answer.
   */
  source: "manual" | "learned";
  /** Sample text that the pattern was learned from / created against. */
  example?: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** How many times this pattern matched something during extraction. */
  useCount: number;
  /** ISO of last successful match. */
  lastUsedAt?: string;
}

/** Result of running a custom pattern against a transcript. */
export interface ExtractionPatternMatch {
  patternId: string;
  value: string;
  /** Original substring that matched, for evidence display. */
  evidence: string;
}

/**
 * Apply all enabled patterns of a given kind. Returns the first match — the
 * patterns array is the priority order, so put more-specific patterns first.
 * Catches invalid regex sources so a malformed user input doesn't crash the
 * whole extraction pass.
 */
export function applyExtractionPatterns(
  text: string,
  patterns: ExtractionPattern[],
  kind: ExtractionPatternKind,
): ExtractionPatternMatch | null {
  for (const p of patterns) {
    if (!p.enabled || p.kind !== kind) continue;
    let re: RegExp;
    try {
      re = new RegExp(p.pattern, p.flags || "i");
    } catch {
      continue;
    }
    const m = text.match(re);
    if (!m) continue;
    const value = (m[p.captureGroup] ?? m[1] ?? m[0] ?? "").trim();
    if (!value) continue;
    return { patternId: p.id, value, evidence: m[0] };
  }
  return null;
}

/**
 * Heuristically derive a pattern from a (transcript, kind, value) example.
 *
 * Strategy:
 *   1. Find the value in the transcript (if literally present).
 *   2. Grab the 2-4 words immediately before it as anchor context.
 *   3. Emit a pattern like `<anchorWords>[\s\S]{0,40}?<valueRegex>`.
 *
 * If the value isn't literally present (e.g., user typed "John" but the
 * transcript only said "name's J"), we fall back to a less-specific pattern
 * keyed by sentence-leading question phrases ("calling for", "your name").
 *
 * The output is intentionally conservative: better to miss than to over-match,
 * because false positives make the panel feel wrong.
 */
export function deriveLearnedPattern(
  transcript: string,
  kind: ExtractionPatternKind,
  value: string,
): { pattern: string; flags: string; captureGroup: number; example: string } | null {
  const v = value.trim();
  if (!v) return null;

  // Per-kind value pattern that the captured group should match.
  const VALUE_RE: Record<ExtractionPatternKind, string> = {
    storeNumber: "(\\d{1,5})",
    registerNumber: "(\\d{1,3})",
    callerName: "([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)",
    errorMessage: "([A-Z][\\w\\s\\-]{3,40})",
    result: "(\\w+)",
  };
  const valueRe = VALUE_RE[kind];

  // 1) Try to anchor on the words immediately before the literal value.
  const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literalIdx = transcript
    .toLowerCase()
    .indexOf(v.toLowerCase());
  if (literalIdx > 0) {
    const before = transcript.slice(Math.max(0, literalIdx - 80), literalIdx);
    const lastWords = before
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(-3);
    if (lastWords.length >= 2) {
      const anchor = lastWords
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
      return {
        pattern: `\\b${anchor}\\b[\\s\\S]{0,40}?\\b${valueRe}\\b`,
        flags: "i",
        captureGroup: 1,
        example: `${lastWords.join(" ")} … ${v}`,
      };
    }
  }

  // 2) Fallback: use a generic question-style anchor for caller / store / etc.
  const KIND_ANCHORS: Record<ExtractionPatternKind, string> = {
    storeNumber: "\\b(?:store|story|stores|location)\\b[\\s\\S]{0,60}?",
    callerName: "\\b(?:your\\s+name|name\\s+is|speaking\\s+with|this\\s+is)\\b[\\s\\S]{0,30}?",
    registerNumber: "\\b(?:register|lane|till)\\b[\\s\\S]{0,30}?",
    errorMessage: "\\b(?:error|message|code|says)\\b[\\s\\S]{0,40}?",
    result: "\\b(?:resolved|pending|escalated|transferred|monitoring)\\b",
  };
  const fallbackEscape = escaped;
  if (kind === "storeNumber" || kind === "registerNumber") {
    return {
      pattern: `${KIND_ANCHORS[kind]}\\b${valueRe}\\b`,
      flags: "i",
      captureGroup: 1,
      example: v,
    };
  }
  // For free-text kinds, anchor on the literal value the user gave so future
  // calls with the same value get auto-detected.
  return {
    pattern: `${KIND_ANCHORS[kind]}(${fallbackEscape})`,
    flags: "i",
    captureGroup: 1,
    example: v,
  };
}

/** Convenience type guard for the result-select kind. */
export function isResultKind(kind: ExtractionPatternKind): boolean {
  return kind === "result";
}

/** Re-export so consumers don't need a second import for TicketResult. */
export type { TicketResult };
