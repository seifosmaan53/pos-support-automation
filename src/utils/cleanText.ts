/**
 * Pick "a" or "an" for the indefinite article in front of `word`. Looks at
 * the spoken initial sound, not just the letter — "an Inseego" (vowel
 * sound), "a USB" (consonant sound "you-ess"), "an MP3" (vowel sound "em").
 * Falls back to letter rule for unknown cases.
 */
export function articleFor(word: string): "a" | "an" {
  const w = word.trim();
  if (!w) return "a";
  const head = w.split(/\s+/)[0];
  // Acronyms whose first letter sounds like a vowel ("F" → "ef", "H" → "aitch",
  // "L" → "el", "M" → "em", "N" → "en", "R" → "ar", "S" → "es", "X" → "ex").
  if (/^[A-Z]{2,}$/.test(head) && /^[AEFHILMNORSX]/.test(head)) return "an";
  // Acronyms whose first letter sounds like a consonant ("U" → "you", etc.).
  if (/^[A-Z]{2,}$/.test(head)) return "a";
  // "Hour", "honor", "honest", "heir" — silent h.
  if (/^h(?:our|onor|onest|eir)/i.test(head)) return "an";
  // "University", "user", "unique", "uniform" — "you" sound.
  if (/^u(?:ni|se|sa|sual|tens|topia)/i.test(head)) return "a";
  // "European", "euro" — "you" sound.
  if (/^eu/i.test(head)) return "a";
  // "One", "once" — "wun" sound.
  if (/^on(?:e|ce)\b/i.test(head)) return "a";
  return /^[aeiou]/i.test(head) ? "an" : "a";
}

export function joinWithAnd(items: string[]): string {
  const cleaned = items.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ensurePeriod(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Strip leading zeros for human-readable narrative output. The analyzer pads
 * store numbers to 5 digits (e.g. "9" → "00009") so retail tooling stays
 * happy, but a sentence like "Store 00009 called…" reads like a bug.
 * Empty input passes through.
 */
export function displayStoreNumber(num: string): string {
  if (!num) return "";
  const stripped = num.replace(/^0+/, "");
  return stripped || num;
}

/**
 * True iff the issue text contains a verb-like signal (copula, modal, action
 * verb, or state participle). When false, the text is a bare noun phrase —
 * "the credit card machine issue" — and templates that introduce it with a
 * `that`-clause ("...reporting that X") will produce ungrammatical output.
 * Callers should switch to a noun-phrase opener like "...reporting an issue
 * with X" via {@link issueAsObject}.
 */
export function isFiniteIssueClause(text: string): boolean {
  return /\b(?:was|were|is|are|wasn'?t|weren'?t|isn'?t|aren'?t|won'?t|wouldn'?t|can'?t|cannot|could\s+not|would\s+not|will\s+not|had|has|have|did|didn'?t|got|getting|gotten|stopped|started|kept|displays?|displayed|showing|shows?|showed|threw|throwing|reads?|reading|comes?|came|coming|appears?|appeared|appearing|crashes?|crashing|crashed|stuck|frozen|broken|down|offline|online|out\s+of\s+state|hardware\s+failure|missing|short|working|printing|responding|connecting|opening|letting|allowing|displaying|throwing|kept)\b/i.test(text);
}

// Acronyms / proper nouns that should preserve their case even when the
// surrounding sentence is lowercased. Add new ones here rather than
// inlining checks at every call site.
const PROTECTED_CASE_WORDS = [
  "USB",
  "POS",
  "COM",
  "BOS",
  "VeriFone",
  "Inseego",
  "ATT",
  "AT&T",
  "PIN",
  "API",
  "URL",
  "ID",
  "IP",
  "TV",
  "OS",
  "PC",
  "DC",
  "AC",
  "MP",
];

/**
 * Lowercase a phrase for clean mid-sentence insertion ("called regarding {x}")
 * while preserving acronyms and known proper nouns. Use this whenever you're
 * about to splice user-provided issue text into a sentence — capital letters
 * inside a noun phrase ("the Credit card machine issue") read as a bug.
 */
export function normalizeSentenceCase(text: string): string {
  if (!text) return text;
  let out = text.toLowerCase();
  for (const w of PROTECTED_CASE_WORDS) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, w);
  }
  // "register N" reads as a proper noun in retail ticket conventions
  // ("on Register 2" / "Register 3 keyboard"), so promote it back to title
  // case after the bulk lowercase.
  out = out.replace(/\bregister(\s+\d+)/g, "Register$1");
  return out;
}

/**
 * Normalize an issue phrase for narrative use:
 *   1. Strips a leading article ("the", "a", "an").
 *   2. Collapses whitespace.
 *   3. Lowercases mid-sentence text via {@link normalizeSentenceCase}.
 *
 * Never lowercases acronyms (USB, POS, VeriFone, …). Idempotent.
 */
export function normalizeIssuePhrase(issue: string): string {
  if (!issue) return "";
  const s = collapseWhitespace(issue.replace(/^(?:the|a|an)\s+/i, ""));
  return normalizeSentenceCase(s);
}

/**
 * True iff the issue text reads as a bare noun phrase ("credit card machine
 * issue", "keyboard problem"). Anything ending in `issue|problem|error|
 * glitch|failure|outage|trouble` is forced to NP, even if a stray clause-y
 * word slipped in elsewhere — readers parse the tail. Otherwise inverts
 * {@link isFiniteIssueClause}.
 */
export function isNounPhrase(text: string): boolean {
  if (!text || !text.trim()) return false;
  const t = text.trim();
  if (/\b(?:issue|problem|error|glitch|failure|outage|trouble)\s*$/i.test(t)) return true;
  return !isFiniteIssueClause(t);
}

/**
 * True iff the issue text reads as a clause (subject + finite verb). The
 * inverse predicate to {@link isNounPhrase}. Use this when picking between
 * "called reporting that {clause}" and "called regarding {a/an noun phrase}".
 */
export function isClause(text: string): boolean {
  if (!text || !text.trim()) return false;
  return !isNounPhrase(text);
}

/**
 * Insert an explicit copula before a bare state adjective so clauses like
 * "internet down" or "BOS stuck while adding employee" read as proper
 * sentences. Conservative: only fires when the input has no copula at all.
 *
 * Two shapes:
 *   - End-of-string adjective ("internet down" → "internet was down").
 *   - Mid-clause adjective ("BOS stuck while adding employee" → "BOS was
 *     stuck while adding employee") — needed because issue text often packs
 *     the subject + adjective + circumstantial clause together with no
 *     copula at all.
 *
 * Plural subjects ("registers down") get "were"; singular gets "was".
 */
export function verbalizeBareState(text: string): string {
  if (!text) return text;
  if (
    /\b(?:was|were|is|are|wasn'?t|weren'?t|isn'?t|aren'?t|had|has|have|did|didn'?t)\b/i.test(text)
  )
    return text;
  // End-of-string adjective.
  const endMatch = /^(.+?)\s+(down|offline|online|working|broken|frozen|stuck|missing)\s*$/i.exec(
    text.trim(),
  );
  if (endMatch) {
    const subject = endMatch[1].trim();
    const adj = endMatch[2].toLowerCase();
    if (subject) return `${subject} ${pluralCopula(subject)} ${adj}`;
  }
  // Mid-clause adjective followed by a tail clause.
  const midMatch =
    /^(\S+(?:\s+\S+){0,3}?)\s+(stuck|frozen|broken|down|offline|online|missing)\s+(.+)$/i.exec(
      text.trim(),
    );
  if (midMatch) {
    const subject = midMatch[1].trim();
    const adj = midMatch[2].toLowerCase();
    const tail = midMatch[3];
    if (subject) return `${subject} ${pluralCopula(subject)} ${adj} ${tail}`;
  }
  return text;
}

function pluralCopula(subject: string): "was" | "were" {
  const head = subject.replace(/\b(?:the|a|an)\s+/i, "").trim();
  // Conservative plural: subject visibly ends in -s AND looks like a noun
  // (not an acronym in all caps like "POS"/"BOS" which end in S but are
  // singular). Acronyms ≥ 2 chars all uppercase → singular.
  if (/^[A-Z]{2,}$/.test(head)) return "was";
  if (/s$/i.test(head)) return "were";
  return "was";
}

/**
 * Build a description-opening sentence given the caller phrase and raw issue
 * text. Picks between two grammatical patterns:
 *
 *   - Noun phrase issue → "{caller} called regarding {a/an} {issue}."
 *       e.g. "Berry from Store 523 called regarding a credit card machine issue."
 *   - Clause issue      → "{caller} called reporting that the {issue (past-tense)}."
 *       e.g. "Store 521 called reporting that the keyboard on Register 2 was not working."
 *
 * Always lowercases the issue body, strips the leading article, picks the
 * correct article (a/an) for noun-phrase form, and inserts a copula for
 * bare-state clauses ("internet down" → "internet was down"). Use this in
 * place of any ad-hoc "{caller} called reporting/regarding {issue}" template.
 */
export function issueToDescriptionOpening(caller: string, issue: string): string {
  const phrase = normalizeIssuePhrase(issue);
  if (!phrase) return ensurePeriod(`${caller} called`);
  if (isClause(phrase)) {
    const verbalized = verbalizeBareState(phrase);
    const past = pastTenseIssue(verbalized);
    // Lead the clause with a definite article unless one is already there or
    // the phrase begins with a possessive ("my keyboard was broken").
    // Bare-plural openers like "registers were displaying ..." need "the"
    // prepended — readers expect "the registers were displaying", not just
    // "registers were displaying".
    // Skip prepending "the" when the clause already starts with a definite/
    // indefinite article, a possessive ("my"), OR a subject pronoun ("they",
    // "we", "I"). Subject pronouns are clause subjects in their own right —
    // "they had a frozen pin pad" doesn't need "the" in front of it.
    const withArticle = /^(?:the|a|an|my|her|his|their|its|our|some|they|we|i|you|he|she|it)\s/i.test(
      past,
    )
      ? past
      : `the ${past}`;
    return ensurePeriod(`${caller} called reporting that ${withArticle}`);
  }
  return ensurePeriod(`${caller} called regarding ${articleFor(phrase)} ${phrase}`);
}

/**
 * Build an "an issue with …" object phrase that slots into "called about ___",
 * "experienced ___", or "reported ___". Handles two input shapes safely:
 *
 *   1. Noun-phrase tail ("the credit card machine issue") — strips the leading
 *      article and the trailing issue/problem/error/glitch/failure word, then
 *      re-prefixes with "an issue with the".
 *   2. Clause shape ("the registers were displaying X" / "internet down") —
 *      extracts the subject head noun via regex and returns "an issue with the
 *      {subject}". Without this, a caller that needs a noun-phrase form
 *      receives ungrammatical text like "an issue with the registers were
 *      displaying X" — a doubled subject + verb that reads as a bug.
 *
 * Falls back to bare "an issue" when neither shape matches.
 */
export function issueAsObject(text: string): string {
  const core = text.trim().replace(/^(?:the|a|an)\s+/i, "");
  if (!core) return "an issue";
  // Noun-phrase tail.
  const npMatch = /\s+(issue|problem|error|glitch|failure|outage|trouble)\s*$/i.exec(core);
  if (npMatch) {
    const without = core.replace(npMatch[0], "").trim();
    if (without) return `an issue with the ${without}`;
    return "an issue";
  }
  // Clause shape — extract subject head before the first finite-verb /
  // state-participle / state-adjective token.
  const clauseMatch =
    /^([\w\s-]+?)\s+(?:was|were|is|are|wasn'?t|weren'?t|isn'?t|aren'?t|had|has|have|did|didn'?t|got|getting|stopped|started|kept|displays?|displayed|showing|shows?|showed|threw|throwing|reads?|reading|comes?|came|coming|appears?|appeared|appearing|crashes?|crashing|crashed|stuck|frozen|broken|down|offline|online|missing|short|working|printing|responding|connecting|opening|letting|allowing|displaying|hardware\s+failure)\b/i.exec(
      core,
    );
  if (clauseMatch) {
    const subject = clauseMatch[1].trim();
    if (subject) return `an issue with the ${subject}`;
  }
  return "an issue";
}

/**
 * Convert a present-tense issue clause to past tense for narrative summaries.
 * Transcripts commonly capture "the printer is not printing"; a summary read
 * after the fact should say "was not printing". Conservative — only touches
 * the most common copulas/auxiliaries to avoid corrupting nouns ("is" inside
 * "this is" is rewritten too, which is fine because issue clauses describe
 * past states).
 */
export function pastTenseIssue(issue: string): string {
  if (!issue) return issue;
  return issue
    .replace(/\b(is|are)\s+not\b/gi, (_m, v) => (v.toLowerCase() === "is" ? "was not" : "were not"))
    .replace(/\baren'?t\b/gi, "weren't")
    .replace(/\bisn'?t\b/gi, "wasn't")
    .replace(/\b(is|are)\b/gi, (_m, v) => (v.toLowerCase() === "is" ? "was" : "were"))
    .replace(/\bsays\b/gi, "said")
    .replace(/\bshows\b/gi, "showed")
    .replace(/\bdisplays\b/gi, "displayed")
    .replace(/\bwon'?t\b/gi, "would not")
    .replace(/\bcan'?t\b/gi, "could not")
    .replace(/\bcannot\b/gi, "could not");
}

const VERB_FORMS: Record<string, { past: string; gerund: string }> = {
  restart: { past: "restarted", gerund: "restarting" },
  reboot: { past: "rebooted", gerund: "rebooting" },
  reset: { past: "reset", gerund: "resetting" },
  unplug: { past: "unplugged", gerund: "unplugging" },
  plug: { past: "plugged", gerund: "plugging" },
  replug: { past: "replugged", gerund: "replugging" },
  reconnect: { past: "reconnected", gerund: "reconnecting" },
  check: { past: "checked", gerund: "checking" },
  verify: { past: "verified", gerund: "verifying" },
  test: { past: "tested", gerund: "testing" },
  run: { past: "ran", gerund: "running" },
  replace: { past: "replaced", gerund: "replacing" },
  swap: { past: "swapped", gerund: "swapping" },
  clean: { past: "cleaned", gerund: "cleaning" },
  update: { past: "updated", gerund: "updating" },
  install: { past: "installed", gerund: "installing" },
  reinstall: { past: "reinstalled", gerund: "reinstalling" },
  configure: { past: "configured", gerund: "configuring" },
  rename: { past: "renamed", gerund: "renaming" },
  reseat: { past: "reseated", gerund: "reseating" },
  perform: { past: "performed", gerund: "performing" },
  create: { past: "created", gerund: "creating" },
  investigate: { past: "investigated", gerund: "investigating" },
  confirm: { past: "confirmed", gerund: "confirming" },
  deactivate: { past: "deactivated", gerund: "deactivating" },
  open: { past: "opened", gerund: "opening" },
  cut: { past: "cut", gerund: "cutting" },
  send: { past: "sent", gerund: "sending" },
  escape: { past: "escaped", gerund: "escaping" },
  exit: { past: "exited", gerund: "exiting" },
  enter: { past: "entered", gerund: "entering" },
  "re-enter": { past: "re-entered", gerund: "re-entering" },
  "re-run": { past: "re-ran", gerund: "re-running" },
  have: { past: "had", gerund: "having" },
  do: { past: "did", gerund: "doing" },
  give: { past: "gave", gerund: "giving" },
  instruct: { past: "instructed", gerund: "instructing" },
  advise: { past: "advised", gerund: "advising" },
  swipe: { past: "swiped", gerund: "swiping" },
  read: { past: "read", gerund: "reading" },
  type: { past: "typed", gerund: "typing" },
  wait: { past: "waited", gerund: "waiting" },
  press: { past: "pressed", gerund: "pressing" },
  log: { past: "logged", gerund: "logging" },
  void: { past: "voided", gerund: "voiding" },
  review: { past: "reviewed", gerund: "reviewing" },
  retry: { past: "retried", gerund: "retrying" },
  clear: { past: "cleared", gerund: "clearing" },
};

/**
 * Convert the leading verb of a step phrase to past or gerund form. Steps
 * are extracted in imperative form ("restart the POS") because that is how
 * tech support phrases instructions in dialogue. Narrative summaries need
 * past tense ("restarted the POS") or gerund after "after"-clauses
 * ("…resolved after restarting the POS"). Idempotent: a step that already
 * starts with the past or gerund form is returned unchanged.
 */
/**
 * Normalize a raw step string into a clean imperative form before any
 * past-tense / gerund / passive transform runs.
 *
 *  - Strips causative wrappers: "had her restart" / "had the store restart" /
 *    "told them to restart" / "asked them to restart" / "tried to restart"
 *    → "restart" (with its object intact).
 *  - Adds missing definite article before a bare object noun:
 *    "advised store to wait …" → "advised the store to wait …".
 *  - Trims whitespace and stray leading conjunctions.
 *
 * Idempotent: a clean imperative step round-trips unchanged.
 */
export function normalizeStep(step: string): string {
  let s = step.trim();
  if (!s) return s;
  s = s.replace(
    /^(?:had|told|asked|got|made)\s+(?:them|the\s+store|him|her|the\s+(?:cashier|operator|manager))\s+(?:to\s+)?/i,
    "",
  );
  s = s.replace(/^tried\s+to\s+/i, "");
  s = s.replace(
    /^(advised|told|instructed|asked|reminded)\s+store\b/i,
    (_m, verb: string) => `${verb} the store`,
  );
  s = s.replace(/^(?:and|then)\s+/i, "");
  return s.trim();
}

/**
 * Verb-level rewrites that turn dialogue verbs into ticket-writing verbs.
 * Applied BEFORE tense transforms so "escaped out of" → "exited out of"
 * round-trips cleanly through any of the three forms (imperative / past /
 * gerund) downstream. Each entry is `[fromAnyForm, toBaseForm]`; the family
 * mapping covers all three forms via shared regex prefixes.
 */
const STEP_VERB_REWRITES: Array<{ pattern: RegExp; replacement: string }> = [
  // "escaped out of" reads as a panic action; the standard ticket wording is
  // "exited out of". Covers imperative, past, and gerund forms.
  { pattern: /\bescape\s+out\s+of\b/gi, replacement: "exit out of" },
  { pattern: /\bescaped\s+out\s+of\b/gi, replacement: "exited out of" },
  { pattern: /\bescaping\s+out\s+of\b/gi, replacement: "exiting out of" },
];

/**
 * Apply both {@link normalizeStep} (causative wrapper / article fixes) and
 * the dialogue-verb → ticket-verb rewrites in {@link STEP_VERB_REWRITES}.
 * Use this in every step pipeline that surfaces in user-facing narrative —
 * raw `normalizeStep` is no longer enough because it doesn't fix dialogue
 * verbs like "escaped out of" that read awkwardly in tickets.
 */
export function normalizeTroubleshootingStep(step: string): string {
  let s = normalizeStep(step);
  for (const { pattern, replacement } of STEP_VERB_REWRITES) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

export function transformStep(step: string, form: "past" | "gerund"): string {
  const trimmed = step.trim();
  if (!trimmed) return trimmed;
  const m = /^([A-Za-z][A-Za-z-]*)(\s.*|$)/.exec(trimmed);
  if (!m) return trimmed;
  const head = m[1].toLowerCase();
  const tail = m[2];
  for (const [base, forms] of Object.entries(VERB_FORMS)) {
    if (head === base || head === forms.past || head === forms.gerund) {
      return forms[form] + tail;
    }
  }
  return trimmed;
}
