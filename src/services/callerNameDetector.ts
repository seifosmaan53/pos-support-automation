/**
 * Phase 11B — generic caller-name detection (no hardcoded names).
 *
 * Used by BOTH the live chunk processor and the final-transcript analyzer
 * so the two paths agree on what counts as a caller name. The detector is
 * purely pattern-based: it knows shapes ("this is X", "may I have your
 * name?" → "X.", "the manager, X") and what's NOT a name (store/register/
 * keyboard/yes/no etc.). It does NOT carry a list of acceptable names —
 * the system supports ~1100 stores, so any normal first name should work.
 *
 * Three entry points:
 *   • detectCallerNameInText(text)        — one utterance, inline patterns only
 *   • detectCallerNameFromAnswer(q, a)    — tech question + caller reply
 *   • detectCallerNameInSequence(items)   — walks an ordered list, fires both
 *
 * All three return either null (nothing reliable) or a DetectedName with:
 *   • name             — title-cased
 *   • confidence       — "high" | "medium" | "review_needed"
 *   • source           — the matched phrase, for evidence display
 *   • role             — when a role label was paired with the name
 *                        ("I'm the store manager, Rebecca")
 */

export type NameConfidence = "high" | "medium" | "review_needed";

export interface DetectedName {
  name: string;
  confidence: NameConfidence;
  source: string;
  role?: "Store Manager" | "Assistant Manager" | "Store Employee";
}

// ─────────────────────────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────────────────────────

// One capitalized word, 2–20 letters, with optional apostrophe/hyphen for
// names like "O'Brien" or "Mary-Anne". The token is matched case-insensitively
// in the patterns below; the actual case is normalized via titleCase().
const NAME_TOKEN = "[A-Za-z][A-Za-z]{1,19}(?:['-][A-Za-z]?[A-Za-z]{1,15})?";

/**
 * Words that look like a captured name but aren't. Applied to every captured
 * token before returning. The list pulls from three sources:
 *   • Phase 11B spec false-positives (store/register/POS/Inseego/keyboard…)
 *   • Common-English continuation words after "I'm" / "I am"
 *     ("I'm calling…", "I'm going to…")
 *   • Day / time words ("Today", "Tomorrow")
 * The check is case-insensitive.
 */
const STOP_NAME = new Set<string>([
  // Pronouns / determiners
  "the", "a", "an", "this", "that", "these", "those",
  "he", "she", "they", "it", "we", "i",
  // Spec false-positives: store, devices, brands
  "store", "register", "pos", "verifone", "fone",
  "inseego", "see", "go",
  "receipt", "printer",
  "keyboard", "mouse",
  "pin", "pad",
  "scanner",
  "computer", "machine", "terminal",
  "credit", "card",
  // Roles — captured as ROLE, not as NAME
  "manager", "customer", "employee", "cashier", "associate",
  "tech", "support", "vendor", "agent", "supervisor",
  // Failure / status words
  "hardware", "failure",
  "yes", "yeah", "yep", "no", "nope", "okay", "ok", "sure",
  "back", "normal", "working", "down", "online", "offline", "broken",
  "not", "still",
  // Continuations after "I'm" / "I am"
  "calling", "going", "trying", "looking", "thinking", "talking",
  "having", "doing",
  "here", "afraid", "sorry", "good", "fine", "well",
  "in", "on", "from", "with", "at", "to",
  // Common verbs / adverbs that show up between a name and "from Store"
  // and that ASR sometimes capitalizes at sentence starts.
  "called", "calls", "callers",
  "said", "told", "asked", "reported",
  "just", "only", "still", "now", "then", "even", "also", "once",
  "ever", "never", "almost", "already", "back",
  // Day / time words
  "today", "tomorrow", "yesterday", "earlier", "later",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  // Brand initialisms that get title-cased by ASR
  "pcf", "bos", "com", "pro",
  // Misc that ASR loves to capitalize at sentence start
  "hello", "hi", "hey", "thanks", "thank",
]);

function isStopName(s: string): boolean {
  return STOP_NAME.has(s.toLowerCase());
}

function titleCase(s: string): string {
  return s
    .split(/(['-])/) // keep separators
    .map((piece) =>
      /^[A-Za-z]/.test(piece)
        ? piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase()
        : piece,
    )
    .join("");
}

// ─────────────────────────────────────────────────────────────────
// Inline patterns (one utterance)
// ─────────────────────────────────────────────────────────────────

interface InlinePattern {
  re: RegExp;
  conf: NameConfidence;
  role?: DetectedName["role"];
}

// Order: highest-confidence patterns first.
const INLINE_PATTERNS: InlinePattern[] = [
  // "my name is X"
  { re: new RegExp(`\\bmy\\s+name\\s+is\\s+(${NAME_TOKEN})\\b`, "i"), conf: "high" },
  // Role-paired: "I'm the (store )?manager, X" / "this is the manager, X"
  {
    re: new RegExp(
      `\\b(?:i'?m|i\\s+am|this\\s+is)\\s+(?:the\\s+)?(?:store\\s+)?manager[,\\s]+(${NAME_TOKEN})\\b`,
      "i",
    ),
    conf: "high",
    role: "Store Manager",
  },
  {
    re: new RegExp(
      `\\b(?:i'?m|i\\s+am|this\\s+is)\\s+(?:the\\s+)?assistant\\s+manager[,\\s]+(${NAME_TOKEN})\\b`,
      "i",
    ),
    conf: "high",
    role: "Assistant Manager",
  },
  // "this is X" (after optional honorific) — word-boundary-anchored
  {
    re: new RegExp(
      `\\bthis\\s+is\\s+(?:Ms\\.?|Mr\\.?|Mrs\\.?|Miss\\s+)?(${NAME_TOKEN})\\b`,
      "i",
    ),
    conf: "high",
  },
  // "(you're )?speaking to/with X"
  {
    re: new RegExp(
      `\\b(?:you'?re\\s+)?speaking\\s+(?:to|with)\\s+(${NAME_TOKEN})\\b`,
      "i",
    ),
    conf: "high",
  },
  // "X here" (e.g. "Maria here")
  { re: new RegExp(`^\\s*(${NAME_TOKEN})\\s+here\\b`, "i"), conf: "high" },
  // "X from Store NNN" / "X calling from Store NNN" — anchored to clause
  // start so adverbs in the middle of a sentence ("Keyana called from
  // Store 657" / "...just from Store 523...") don't get captured as names.
  // This pattern fires for caller self-introductions, e.g. "Angela from
  // Store 1518." standing alone.
  {
    re: new RegExp(
      `(?:^|[.!?]\\s+)(${NAME_TOKEN})(?:\\s+(?:calling|here))?\\s+from\\s+Store\\s+\\d+\\b`,
      "i",
    ),
    conf: "high",
  },
  // "I'm X" / "I am X" — false-positive prone, medium confidence; falls
  // through if X is in STOP_NAME ("I'm calling", "I'm the manager").
  { re: new RegExp(`\\bi\\s+am\\s+(${NAME_TOKEN})\\b`, "i"), conf: "medium" },
  { re: new RegExp(`\\bi'?m\\s+(${NAME_TOKEN})\\b`, "i"), conf: "medium" },
];

/**
 * Run the inline patterns against one utterance. Returns the highest-rated
 * match or null. Demotes the confidence to `review_needed` if there's a "?"
 * immediately around the captured name (whisper often appends "?" when the
 * model itself is uncertain about a proper noun).
 */
export function detectCallerNameInText(text: string): DetectedName | null {
  const stripped = text.trim();
  if (!stripped) return null;
  for (const { re, conf, role } of INLINE_PATTERNS) {
    const m = re.exec(stripped);
    if (!m || !m[1]) continue;
    if (isStopName(m[1])) continue;
    const name = titleCase(m[1]);
    const localStart = Math.max(0, m.index - 4);
    const localEnd = Math.min(stripped.length, m.index + m[0].length + 4);
    const local = stripped.slice(localStart, localEnd);
    const finalConf: NameConfidence = /\?/.test(local) ? "review_needed" : conf;
    return { name, confidence: finalConf, source: m[0], role };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Q-and-A: tech asks for the name, caller's next utterance is the answer
// ─────────────────────────────────────────────────────────────────

const NAME_QUESTION =
  /\b(?:may\s+I\s+(?:please\s+)?have\s+your\s+name|can\s+I\s+(?:please\s+)?(?:get|have)\s+your\s+name|what(?:'?s|\s+is)\s+your\s+name|who\s+(?:am\s+I|are\s+we)\s+speaking\s+(?:with|to))\b/i;

const NON_NAME_ANSWER_HEAD =
  /^(?:store\s+\d+|register\s+\d+|pos\b|the\s+(?:store|register|printer|keyboard|mouse)|hardware\s+failure|yes|no|nope|nah|okay|ok|sure|maybe|hold\s+on|let\s+me\s+(?:check|see)|i\s+don'?t\s+(?:know|remember))/i;

// "Ms. Name" / "Mr. Name" / "Mrs. Name" / "Miss Name" — strip the honorific.
const ANSWER_NAME_AT_HEAD = new RegExp(
  `^(?:(?:Ms\\.?|Mr\\.?|Mrs\\.?|Miss)\\s+)?(${NAME_TOKEN})(?:\\s+(${NAME_TOKEN}))?\\b`,
);

export function detectCallerNameFromAnswer(
  techText: string,
  callerText: string,
): DetectedName | null {
  if (!NAME_QUESTION.test(techText)) return null;
  const ans = callerText.trim();
  if (!ans) return null;

  // Reject non-name answers like "Store 870." or "Register 2." — extraction
  // for those values lives elsewhere and shouldn't be polluted.
  if (NON_NAME_ANSWER_HEAD.test(ans)) return null;

  // First try inline patterns — handles "This is David." after a name prompt.
  const inline = detectCallerNameInText(ans);
  if (inline) return inline;

  // Otherwise: short answer with a leading capitalized token ("Maria.").
  const m = ANSWER_NAME_AT_HEAD.exec(ans);
  if (!m || !m[1] || isStopName(m[1])) return null;

  // Two consecutive capitalized words → first+last. Reject if the second
  // word is a stop-name (e.g. "Maria Manager" — clearly wrong).
  let captured = m[1];
  if (m[2] && !isStopName(m[2])) {
    captured = `${m[1]} ${m[2]}`;
  }
  const name = captured.split(/\s+/).map(titleCase).join(" ");
  // Demote to review_needed when the caller's answer ends with "?" — common
  // when whisper isn't confident about the proper noun ("Kayla?").
  const conf: NameConfidence = /\?$/.test(ans) ? "review_needed" : "high";
  return {
    name,
    confidence: conf,
    source: `Q: ${techText.slice(0, 60)} → A: ${ans.slice(0, 60)}`,
  };
}

// ─────────────────────────────────────────────────────────────────
// Sequence walker — used by both the live and final paths
// ─────────────────────────────────────────────────────────────────

export interface NameDetectionItem {
  text: string;
  /**
   * Whether this utterance is tech-side, caller-side, or unknown.
   * "unknown" lets the helper work on flat sentence streams (the final
   * analyzer's path) — Q→A still fires because the question itself is
   * recognizable from the text.
   */
  side?: "tech" | "caller" | "unknown";
}

/**
 * Walks the sequence in order, running inline + Q→A detection at each step,
 * and returns the highest-confidence hit. When two hits tie on confidence,
 * the LAST one wins — later self-introductions are more authoritative
 * (the caller may have corrected an earlier mishearing).
 */
export function detectCallerNameInSequence(
  items: NameDetectionItem[],
): DetectedName | null {
  let best: DetectedName | null = null;

  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    const side = cur.side ?? "unknown";

    if (side === "caller" || side === "unknown") {
      const hit = detectCallerNameInText(cur.text);
      if (hit && isAtLeastAsGood(hit, best)) best = hit;
    }

    if (i > 0 && (side === "caller" || side === "unknown")) {
      const prev = items[i - 1];
      const prevSide = prev.side ?? "unknown";
      if (prevSide === "tech" || prevSide === "unknown") {
        const hit = detectCallerNameFromAnswer(prev.text, cur.text);
        if (hit && isAtLeastAsGood(hit, best)) best = hit;
      }
    }
  }

  return best;
}

function isAtLeastAsGood(a: DetectedName, b: DetectedName | null): boolean {
  if (!b) return true;
  const rank: Record<NameConfidence, number> = {
    high: 3,
    medium: 2,
    review_needed: 1,
  };
  return rank[a.confidence] >= rank[b.confidence];
}

// ─────────────────────────────────────────────────────────────────
// Legacy alias for the live chunk path
// ─────────────────────────────────────────────────────────────────

/**
 * Single-utterance shortcut — same as `detectCallerNameInText`. Kept under
 * the old name because `processLiveChunk` already imports `detectCallerName`
 * by that identifier.
 */
export function detectCallerName(text: string): DetectedName | null {
  return detectCallerNameInText(text);
}
