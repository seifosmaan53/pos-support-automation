/**
 * Central source of truth for the Store Ticket Assistant writing voice.
 *
 * Three things live here:
 *
 *  1. {@link WRITING_RULES} — short rule cards (rule + reason) rendered in the
 *     Writing Lab and consumed by tests as documentation.
 *  2. {@link FORBIDDEN_PHRASES} — patterns that must NEVER appear in any
 *     generated subject/description/resolution/summary. Imported by the
 *     forbidden-phrase test suite.
 *  3. {@link WRITING_QUALITY_CHECKLIST} — the manual QA checklist surfaced in
 *     the Writing Lab so a human reviewer can score a generated ticket.
 *
 * If you change the writing rules, update this file first — tests + UI both
 * read from it, so a single edit propagates everywhere.
 */

export interface WritingRule {
  /** Short imperative title (renders as a card header). */
  rule: string;
  /** One-sentence reason / example. */
  reason: string;
}

export const WRITING_RULES: WritingRule[] = [
  {
    rule: "Use “called regarding” for noun-phrase issues",
    reason:
      'A noun phrase like "credit card machine issue" must read as "called regarding a credit card machine issue", not the broken hybrid "called reporting that the credit card machine issue".',
  },
  {
    rule: "Use “called reporting that” only for full clauses",
    reason:
      '"the keyboard was not working" is a clause and reads as "called reporting that the keyboard was not working". Never insert a clause-introducer in front of a noun phrase.',
  },
  {
    rule: "Keep Description and Resolution separate",
    reason:
      "Description tells the story (who called, what happened, what was tried, outcome). Resolution is a tight summary of the steps + verdict — never duplicate the description there.",
  },
  {
    rule: "Do not write dialogue",
    reason:
      'Tickets summarize a call in third person ("the store called and reported …"), not the literal back-and-forth ("Hi, this is Store 9. Unplug the printer.").',
  },
  {
    rule: "Do not overuse “Troubleshooting included”",
    reason:
      "If the sentence already reads naturally with “the store was advised to …” or “the cables were reseated and the device rebooted”, prefer that over forcing every step list under a single heading.",
  },
  {
    rule: "Use natural technician wording",
    reason:
      'Match how a real tech writes a ticket: "exited out of the transaction", "advised the store to wait one second", "reseated the cables". Never echo dialogue verbs like "escaped out of".',
  },
  {
    rule: "Lowercase issue phrases mid-sentence",
    reason:
      'Inside "called regarding a {issue}", the issue body is mid-sentence and must read lowercase ("a credit card machine issue", not "a Credit card machine issue"). Acronyms and proper nouns are the only exception.',
  },
  {
    rule: "Preserve acronyms and device names",
    reason:
      "POS, USB, COM, BOS, PCF, ATT, PIN, VeriFone, and Inseego stay in their canonical case even when the surrounding sentence is lowercased.",
  },
  {
    rule: "Do not invent fixes",
    reason:
      "Only describe steps the analyzer actually captured. If the structured details say the store rebooted the modem, do not also claim a power drain was performed.",
  },
  {
    rule: "Do not mark resolved unless confirmed",
    reason:
      'Use "The issue was confirmed resolved." only when result === "Resolved". For ResultNotConfirmed/Pending/Escalated/etc., emit the matching outcome sentence and never claim the issue was resolved.',
  },
  {
    rule: "Generate a Part Request only when a replacement is actually needed",
    reason:
      "partRequest must come from `details.partNeeded === true`. A step like \"replaced the cable\" on a Resolved ticket does not produce a forward-looking part request.",
  },
];

/**
 * Regex patterns that must never appear in any generated ticket field.
 *
 * Each entry includes a `description` so a failing test prints the rule the
 * pattern protects, not just the regex source. Patterns are case-insensitive
 * unless they specifically protect a capitalised acronym/proper noun.
 */
export interface ForbiddenPattern {
  pattern: RegExp;
  description: string;
}

export const FORBIDDEN_PHRASES: ForbiddenPattern[] = [
  {
    pattern: /called reporting that the (?:[a-z][a-z\s]*?)\s+(?:issue|problem|error|glitch|failure|outage|trouble)\b/i,
    description:
      "Hybrid form: 'called reporting that the X issue' — noun phrases must use 'called regarding a X issue'.",
  },
  {
    pattern: /called reporting that the credit card machine issue/i,
    description:
      "Specific Berry/Store 523 regression: must be 'called regarding a credit card machine issue'.",
  },
  {
    pattern: /called reporting that the keyboard issue\b/i,
    description: "Noun phrase 'keyboard issue' must use 'called regarding a keyboard issue'.",
  },
  {
    pattern: /called reporting that the printer problem\b/i,
    description: "Noun phrase 'printer problem' must use 'called regarding a printer problem'.",
  },
  {
    pattern: /the Credit card machine issue/,
    description:
      "Capital C inside a mid-sentence noun phrase — must be lowercased ('credit card machine issue').",
  },
  {
    pattern: /Troubleshooting included escaped out\b/i,
    description:
      "Dialogue verb 'escaped out' leaked into ticket — must be normalized to 'exited out'.",
  },
  {
    pattern: /\bescaped out of\b/i,
    description: "Dialogue verb — must be normalized to 'exited out of'.",
  },
  {
    pattern: /\badvised store\b(?!\s+(?:was|to))/i,
    description:
      "Bare 'advised store' missing definite article — must be 'advised the store'. (Allow 'store was advised to …' phrasing.)",
  },
  {
    pattern: /power green\b/i,
    description: "ASR mishearing of 'power drain' — must never reach a ticket.",
  },
  {
    pattern: /\bstory\b/i,
    description: "ASR mishearing of 'store' — must never reach a ticket.",
  },
  {
    pattern: /\b(?:wrist|rest)\s+\d/i,
    description: "ASR mishearing of 'register N' — must never reach a ticket.",
  },
];

/**
 * Build a list of forbidden-phrase descriptors that ALSO need a `result`
 * predicate to evaluate. These can't be expressed as a pure regex because
 * the rule depends on the structured outcome of the ticket.
 */
export interface ResultGatedForbiddenPattern {
  pattern: RegExp;
  description: string;
  /** Returns true when the rule applies to the given details. */
  appliesWhen: (details: { result: string; partNeeded: boolean }) => boolean;
}

export const RESULT_GATED_FORBIDDEN_PHRASES: ResultGatedForbiddenPattern[] = [
  {
    pattern: /\bissue was resolved\b/i,
    description:
      "Claiming 'issue was resolved' when result is not Resolved — must use the outcome wording for the actual result.",
    appliesWhen: ({ result }) => result !== "Resolved" && result !== "WrongCaller" && result !== "Transferred",
  },
  {
    pattern: /\b(?:replacement ticket will be opened|replacement is required|requires replacement|appears to require replacement|needs replacement|please send a (?:replacement|new))/i,
    description:
      "Part request fired when partNeeded is false — only emit replacement language when details.partNeeded is true.",
    appliesWhen: ({ partNeeded }) => !partNeeded,
  },
];

export const WRITING_QUALITY_CHECKLIST: readonly string[] = [
  "Does it sound like a real ticket?",
  "Is the issue clear?",
  "Are troubleshooting steps natural?",
  "Is the resolution separate from the description?",
  "Did it avoid dialogue?",
  "Did it avoid inventing details?",
  "Did it avoid awkward grammar (no 'reporting that the X issue', no 'Credit card' mid-sentence)?",
  "Did it preserve important details (store, register, error message, transaction number)?",
  "Did it preserve acronyms (POS, USB, BOS, PCF, ATT, PIN, VeriFone, Inseego)?",
  "Did it mark the result correctly (Resolved only when confirmed)?",
] as const;
