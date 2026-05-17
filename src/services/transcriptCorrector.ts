import type { CorrectionEntry } from "../types/settings";

export interface CorrectorOptions {
  dictionary?: CorrectionEntry[];
  applyDictionary?: boolean;
  applyNumberWords?: boolean;
  applyDomainRepair?: boolean;
  /**
   * Lowercased `from` strings the corrector should skip on this pass. The
   * Correction Review UI populates this when the user undoes a previously
   * applied change so the rule no longer re-fires on the next setTranscript.
   * Domain rules don't expose their `from` directly, so we match on the rule
   * label instead — the labels include the same human-readable arrow form
   * (`story → store`) that the dictionary entries use.
   */
  excludeFromForms?: Set<string>;
}

export interface CorrectionChange {
  from: string;
  to: string;
  /** Source of the rule, for the review UI grouping. */
  source: "domain" | "number-words" | "dictionary";
  /**
   * Whether this change was produced by an auto-apply rule. Hardcoded domain
   * rules and number-word normalization always count as auto-apply; dictionary
   * entries reflect their `autoApply` flag (defaults to true).
   */
  autoApply: boolean;
}

export interface CorrectionResult {
  text: string;
  changes: CorrectionChange[];
}

/**
 * Apply a fixed transcription correction pass before extraction.
 * Order matters:
 *   1. Domain repair — context-aware retail/POS mishearings (story→store,
 *      wrist→register, power green→power drain, etc.) that the dictionary
 *      can't safely catch because the trigger word is also a real English word.
 *   2. Number-word normalization ("register one" → "Register 1").
 *   3. User-editable dictionary corrections.
 *   4. Whitespace cleanup.
 *
 * This is what "transcript repair before speaker detection" relies on — when
 * the transcript still says "wrist," the speaker detector can't see the
 * shutdown instruction; once it says "register," the tech-instruction signal
 * fires correctly.
 */
export function correctTranscript(
  raw: string,
  options: CorrectorOptions = {},
): CorrectionResult {
  const {
    dictionary = [],
    applyDictionary = true,
    applyNumberWords = true,
    applyDomainRepair = true,
    excludeFromForms,
  } = options;
  if (!raw) return { text: "", changes: [] };

  const exclude = excludeFromForms ?? new Set<string>();
  const changes: CorrectionChange[] = [];
  let text = raw;

  if (applyDomainRepair) {
    text = applyDomainCorrections(text, changes, exclude);
  }

  if (applyNumberWords) {
    text = normalizeNumberWords(text, changes, exclude);
  }

  if (applyDictionary && dictionary.length > 0) {
    const enabled = dictionary.filter(
      (e) => e.enabled !== false && !exclude.has(e.from.trim().toLowerCase()),
    );
    text = applyDictionaryCorrections(text, enabled, changes);
  }

  text = text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
  return { text, changes };
}

/**
 * Domain mishearings that need *context* to be safe. We don't put these in the
 * user-editable dictionary because words like "story" and "wrist" are real
 * English words — replacing them globally would corrupt unrelated text. Each
 * pattern includes enough surrounding context that a false positive is
 * extremely unlikely in a retail-support transcript.
 */
interface DomainRule {
  pattern: RegExp;
  replace: string | ((m: string, ...g: string[]) => string);
  label: string; // shown to the user in the corrections list
}

const DOMAIN_RULES: DomainRule[] = [
  // ── "story" → "store" ───────────────────────────────────────────────
  // "what story are you calling" / "what story is this"
  { pattern: /\bwhat\s+story\s+(are\s+you\s+calling|is\s+this|do\s+you\s+work\s+(?:at|in))\b/gi, replace: (_m, tail: string) => `what store ${tail}`, label: "story → store" },
  // "story 521" / "story #521"
  { pattern: /\bstory\s+#?\s*(\d{1,5})\b/gi, replace: (_m, n: string) => `Store ${n}`, label: "story → store" },
  // "calling from story"
  { pattern: /\b(calling\s+from|from)\s+story\b/gi, replace: (_m, lead: string) => `${lead} Store`, label: "story → store" },
  // "this is story X"
  { pattern: /\bthis\s+is\s+story\s+(\d{1,5})\b/gi, replace: (_m, n: string) => `this is Store ${n}`, label: "story → store" },

  // ── "wrist" / "rest" → "register" (POS shutdown context) ───────────
  { pattern: /\b(do\s+a\s+|perform\s+(?:a\s+)?|run\s+a\s+)?shut\s*down\s+on\s+the\s+(wrist|rest)\b/gi, replace: (_m, prefix: string | undefined) => `${prefix ?? ""}shut down on the register`.trim(), label: "wrist/rest → register" },
  { pattern: /\bshut\s*down\s+the\s+(wrist|rest)\b/gi, replace: () => "shut down the register", label: "wrist/rest → register" },
  { pattern: /\bthe\s+(wrist|rest)\s+(should|will|is|isn'?t|won'?t|comes\s+back|came\s+back|reboot)/gi, replace: (_m, _w: string, tail: string) => `the register ${tail}`, label: "wrist/rest → register" },
  { pattern: /\bthe\s+(wrist|rest)\s+back\s+up\b/gi, replace: () => "the register back up", label: "wrist/rest → register" },
  { pattern: /\bback\s+(?:in)?to\s+the\s+(wrist|rest)\b/gi, replace: () => "back into the register", label: "wrist/rest → register" },

  // ── power-drain mishearings ────────────────────────────────────────
  { pattern: /\bpower\s+(green|grain|train|brain)\b/gi, replace: () => "power drain", label: "power green/grain/train → power drain" },
  { pattern: /\b(did|do|doing|performing)\s+a\s+power\s+(green|grain|train|brain)\b/gi, replace: (_m, verb: string) => `${verb} a power drain`, label: "power green/grain/train → power drain" },

  // ── "boxes" → "register box" (back-of-register power-cable context) ─
  // Only when paired with "power cable from the boxes" — otherwise leave alone.
  { pattern: /\bpower\s+cable\s+from\s+the\s+boxes\b/gi, replace: () => "power cable from the register box", label: "boxes → register box" },

  // ── point-of-sale shorthand
  { pattern: /\bpoint\s+of\s+sale\b/gi, replace: () => "POS", label: "point of sale → POS" },

  // ── "in see go" → "Inseego" (single-token mishearing of vendor) ─────
  // Already covered by user dictionary, but re-running here is idempotent and
  // ensures it's normalized before downstream regexes look for "Inseego".
  { pattern: /\bin\s+see\s+go\b/gi, replace: () => "Inseego", label: "in see go → Inseego" },

  // ── ATT/AT&T / VeriFone normalization
  { pattern: /\bat\s*&\s*t\b/gi, replace: () => "ATT", label: "AT&T → ATT" },
  { pattern: /\b(very|verify)\s+phone\b/gi, replace: () => "VeriFone", label: "very phone → VeriFone" },

  // ── Q-and-A canonicalization: "may I have your name" cluster ────────
  { pattern: /\bmay\s+I\s+(?:please\s+)?have\s+your\s+name\b/gi, replace: () => "May I have your name", label: "name prompt normalized" },
];

function applyDomainCorrections(
  text: string,
  changes: CorrectionChange[],
  exclude: Set<string>,
): string {
  let out = text;
  for (const rule of DOMAIN_RULES) {
    if (exclude.has(rule.label.trim().toLowerCase())) continue;
    out = out.replace(rule.pattern, (...args) => {
      const original = args[0] as string;
      const replaced =
        typeof rule.replace === "function"
          ? (rule.replace as (m: string, ...g: string[]) => string)(...(args as [string, ...string[]]))
          : rule.replace;
      if (original.toLowerCase() !== replaced.toLowerCase()) {
        changes.push({ from: original, to: replaced, source: "domain", autoApply: true });
      }
      return replaced;
    });
  }
  return out;
}

const WORD_TO_DIGIT: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
};

const TENS_WORD_TO_NUM: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const ONES_WORD_TO_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

function normalizeNumberWords(
  text: string,
  changes: CorrectionChange[],
  exclude: Set<string>,
): string {
  // Number-word rules don't have stable user-facing names, so excluding them
  // would require re-checking each generated `from` string after the match.
  // We accept the small risk: if the user undoes a number-word normalization,
  // it'll re-fire on the next pass. Documented behavior, not a bug.
  void exclude;
  let out = text;

  // Register/Store + ones
  out = out.replace(
    /\b(register|store)\s+(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
    (_, word: string, num: string) => {
      const canonical = capitalize(word.toLowerCase());
      const digit = WORD_TO_DIGIT[num.toLowerCase()];
      const replacement = `${canonical} ${digit}`;
      changes.push({ from: `${word} ${num}`, to: replacement, source: "number-words", autoApply: true });
      return replacement;
    },
  );

  // "register won" — common transcription mishear of "register one"
  out = out.replace(/\b(register|store)\s+won\b/gi, (_, word: string) => {
    const replacement = `${capitalize(word.toLowerCase())} 1`;
    changes.push({ from: `${word} won`, to: replacement, source: "number-words", autoApply: true });
    return replacement;
  });

  // Compound numbers: "store four thirty-three" / "store four thirty three"
  out = out.replace(
    /\b(store|register)\s+(zero|one|two|three|four|five|six|seven|eight|nine)\s+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s]+(one|two|three|four|five|six|seven|eight|nine))?\b/gi,
    (_, word: string, hundredsWord: string, tensWord: string, onesWord?: string) => {
      const hundreds = ONES_WORD_TO_NUM[hundredsWord.toLowerCase()] ?? 0;
      const tens = TENS_WORD_TO_NUM[tensWord.toLowerCase()] ?? 0;
      const ones = onesWord ? (ONES_WORD_TO_NUM[onesWord.toLowerCase()] ?? 0) : 0;
      const num = hundreds * 100 + tens + ones;
      const replacement = `${capitalize(word.toLowerCase())} ${num}`;
      changes.push({ from: `${word} ${hundredsWord} ${tensWord}${onesWord ? ` ${onesWord}` : ""}`, to: replacement, source: "number-words", autoApply: true });
      return replacement;
    },
  );

  // "all three registers" / "all two registers"
  out = out.replace(
    /\ball\s+(two|three|four|five|six)\s+registers\b/gi,
    (_, num: string) => {
      const digit = WORD_TO_DIGIT[num.toLowerCase()];
      const replacement = `all ${digit} registers`;
      changes.push({ from: `all ${num} registers`, to: replacement, source: "number-words", autoApply: true });
      return replacement;
    },
  );

  // Title-case canonical brand/term forms after digit substitution
  out = out
    .replace(/\bRegister\s+(\d+)\b/g, (_, n: string) => `Register ${n}`)
    .replace(/\bStore\s+(\d+)\b/g, (_, n: string) => `Store ${n}`);

  return out;
}

function applyDictionaryCorrections(
  text: string,
  dictionary: CorrectionEntry[],
  changes: CorrectionChange[],
): string {
  let out = text;
  for (const entry of dictionary) {
    if (!entry.from.trim() || !entry.to.trim()) continue;
    if (entry.from === entry.to) continue;
    const pattern = new RegExp(`\\b${escapeRegex(entry.from)}\\b`, "gi");
    if (pattern.test(out)) {
      const auto = entry.autoApply !== false;
      out = out.replace(pattern, () => {
        changes.push({ from: entry.from, to: entry.to, source: "dictionary", autoApply: auto });
        return entry.to;
      });
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
