/**
 * Phase 7: Knowledge-driven assist.
 *
 * Reads user-authored knowledge_items and merges them with built-in defaults
 * to produce relevance hits, troubleshooting steps, knowledge-aware
 * Suggested Questions, and part-request rule matches.
 *
 * Knowledge MAY suggest, but ticket facts come from the transcript /
 * ExtractedDetails. The functions in this module return *suggestions* —
 * the caller decides whether to surface them. They never write into the
 * ticket fields themselves.
 */
import type { ExtractedDetails, TicketFields } from "../types/ticket";
import type {
  AnyKnowledgeItem,
  KnowledgeContentByType,
  KnowledgeItem,
} from "../types/knowledge";
import { knowledgeStore } from "./knowledgeStore";

export interface KnowledgeRelevance {
  item: AnyKnowledgeItem;
  score: number;
  reasons: string[];
}

export interface GuidedStepGroup {
  /** Item ID when sourced from a stored guide; empty for built-in defaults. */
  sourceId: string;
  title: string;
  steps: string[];
  warnings: string[];
  questions: string[];
}

export interface PartRequestSuggestion {
  /** "Replacement receipt printer may be needed". */
  partLabel: string;
  reason: string;
  /** Matching item id when sourced from a stored rule, else "" for built-in. */
  sourceId: string;
}

export interface RelevanceInput {
  details: Partial<ExtractedDetails>;
  transcript?: string;
  fields?: Partial<TicketFields>;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "that",
  "this",
  "they",
  "their",
  "have",
  "been",
  "were",
  "into",
  "about",
  "after",
  "before",
  "while",
  "where",
  "which",
  "would",
  "could",
  "should",
  "store",
]);

function tokenize(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function eq(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function any(haystack: string, needles: string[]): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  return needles.some((n) => n && h.includes(n.toLowerCase()));
}

interface RelevanceContext {
  category: string;
  subCategory: string;
  deviceType: string;
  devices: string[];
  result: string;
  errorMessage: string;
  issue: string;
  storeNumber: string;
  partNeeded: boolean;
  haystack: string;
  haystackTokens: Set<string>;
}

function buildContext(input: RelevanceInput): RelevanceContext {
  const d = input.details ?? {};
  const t = (input.transcript ?? "").toLowerCase();
  const haystackParts = [
    d.issue ?? "",
    d.errorMessage ?? "",
    d.deviceType ?? "",
    d.category ?? "",
    d.subCategory ?? "",
    (d.devices ?? []).join(" "),
    input.fields?.subject ?? "",
    input.fields?.description ?? "",
    t,
  ];
  const haystack = haystackParts.join(" ").toLowerCase();
  return {
    category: d.category ?? "",
    subCategory: d.subCategory ?? "",
    deviceType: d.deviceType ?? "",
    devices: d.devices ?? [],
    result: d.result ?? "",
    errorMessage: d.errorMessage ?? "",
    issue: d.issue ?? "",
    storeNumber: d.storeNumber ?? "",
    partNeeded: !!d.partNeeded,
    haystack,
    haystackTokens: new Set(tokenize(haystack)),
  };
}

function scoreItem(
  item: AnyKnowledgeItem,
  ctx: RelevanceContext,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const c = item.content as unknown as Record<string, unknown>;
  const itemCategory = typeof c.category === "string" ? c.category : "";
  const itemDevice = typeof c.deviceType === "string" ? c.deviceType : "";
  const itemKeywords = Array.isArray(c.keywords) ? (c.keywords as string[]) : [];
  const itemTriggers = Array.isArray(c.triggerPhrases)
    ? (c.triggerPhrases as string[])
    : [];

  if (itemCategory && eq(itemCategory, ctx.category)) {
    score += 4;
    reasons.push(`category=${itemCategory}`);
  }
  if (itemDevice && eq(itemDevice, ctx.deviceType)) {
    score += 4;
    reasons.push(`device=${itemDevice}`);
  } else if (itemDevice && ctx.devices.some((d) => eq(d, itemDevice))) {
    score += 3;
    reasons.push(`device list includes ${itemDevice}`);
  }

  for (const kw of itemKeywords) {
    if (!kw) continue;
    if (ctx.haystack.includes(kw.toLowerCase())) {
      score += 2;
      reasons.push(`keyword: ${kw}`);
    }
  }
  for (const phrase of itemTriggers) {
    if (!phrase) continue;
    if (ctx.haystack.includes(phrase.toLowerCase())) {
      score += 3;
      reasons.push(`trigger: ${phrase}`);
    }
  }

  // Title token overlap so a guide titled "Receipt Printer Hardware Failure"
  // still hits when the user types "printer dead".
  const titleTokens = tokenize(item.title);
  const overlap = titleTokens.filter((t) => ctx.haystackTokens.has(t));
  if (overlap.length > 0) {
    score += Math.min(overlap.length, 3);
    reasons.push(`title: ${overlap.join("/")}`);
  }

  // Per-type signals.
  if (item.type === "store_note") {
    const sn = item.content as KnowledgeContentByType["store_note"];
    if (sn.storeNumber && sn.storeNumber === ctx.storeNumber) {
      score += 5;
      reasons.push(`store ${sn.storeNumber}`);
    } else {
      // Store notes only count when they actually match the call's store.
      score = Math.max(0, score - 1);
    }
  }
  if (item.type === "category_mapping") {
    const cm = item.content as KnowledgeContentByType["category_mapping"];
    for (const kw of cm.triggerKeywords) {
      if (kw && ctx.haystack.includes(kw.toLowerCase())) {
        score += 2;
        reasons.push(`mapping kw: ${kw}`);
      }
    }
  }
  if (item.type === "part_request_rule") {
    if (ctx.partNeeded) {
      score += 1;
      reasons.push("partNeeded flag");
    }
  }
  if (item.type === "escalation_rule") {
    if (ctx.result === "Escalated" || ctx.result === "WaitingOnVendor") {
      score += 1;
      reasons.push("result=escalated/vendor");
    }
  }

  return { score, reasons };
}

/**
 * Top relevant knowledge items for the current ticket. Returns 2-5 entries
 * in score-descending order. Caller decides how to render — see
 * `GuidedTroubleshootingPanel` and `SuggestedSolutionsPanel`.
 */
export function relevantKnowledgeForCurrent(
  input: RelevanceInput,
  max = 5,
): KnowledgeRelevance[] {
  const items = knowledgeStore.list();
  if (items.length === 0) return [];
  const ctx = buildContext(input);
  const scored: KnowledgeRelevance[] = [];
  for (const item of items) {
    const { score, reasons } = scoreItem(item, ctx);
    if (score > 0) scored.push({ item, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max);
}

interface BuiltinGuide {
  match: (ctx: RelevanceContext) => boolean;
  title: string;
  steps: string[];
  warnings: string[];
  questions: string[];
}

const BUILTIN_GUIDES: BuiltinGuide[] = [
  {
    match: (c) => /inseego|router|modem|internet|wi[- ]?fi|com\s+services?/i.test(c.haystack),
    title: "Internet / Inseego",
    steps: [
      "Restart Inseego",
      "Confirm connections",
      "Confirm both registers are back online",
    ],
    warnings: ["Confirm whether the issue affects all registers or one."],
    questions: [
      "Is the issue affecting all registers or only one?",
      "Are the Inseego/modem lights normal?",
      "Did the issue come back after restart?",
    ],
  },
  {
    match: (c) => /keyboard/i.test(c.haystack),
    title: "Register Keyboard",
    steps: [
      "Confirm register number",
      "Ask if mouse works",
      "Perform register power drain",
      "Confirm keyboard works after reboot",
      "If still failing, check for bad port/cable and possible replacement",
    ],
    warnings: [
      "Do not request a replacement until power drain has been performed.",
    ],
    questions: [
      "Which register is the keyboard connected to?",
      "Is the issue with typing, click, cable, or power?",
      "Did a power drain fix it?",
      "Is there already an open ticket for replacement?",
    ],
  },
  {
    match: (c) => /receipt\s*printer/i.test(c.haystack),
    title: "Receipt Printer Hardware",
    steps: [
      "Reboot printer/register",
      "Reseat cables",
      "Check if printer loses power when moved",
      "If power port is bad or hardware failure persists, create replacement request",
    ],
    warnings: [
      "Replacement only when power drain + reseat + reboot fail to keep the printer online.",
    ],
    questions: [
      "Does the printer lose power when moved?",
      "Were the cables reseated?",
      "Is the issue still happening after reboot?",
    ],
  },
  {
    match: (c) => /verifone|pin\s*pad|chip\s*reader|card\s*reader/i.test(c.haystack),
    title: "VeriFone / Pin Pad",
    steps: [
      "Restart VeriFone unit and register",
      "Reseat cables and verify connection",
      "Test a card transaction once back online",
      "If still failing, escalate / consider replacement",
    ],
    warnings: ["Confirm whether the issue is one card or all card transactions."],
    questions: [
      "Which register or pin pad is affected?",
      "Is the issue affecting all card transactions or only one card?",
      "Did the card transaction go through after troubleshooting?",
    ],
  },
  {
    match: (c) => /\bbos\b|back\s*office/i.test(c.haystack),
    title: "BOS / Back Office",
    steps: [
      "Confirm the screen / task that's stuck",
      "Restart BOS services if applicable",
      "Verify the user can complete the task afterward",
    ],
    warnings: [],
    questions: [
      "What screen or task was the user working on when it got stuck?",
      "Was there an error message?",
      "Can the user complete the task now?",
    ],
  },
];

/**
 * Steps to surface in the Guided Troubleshooting panel. Combines stored
 * troubleshooting_guide knowledge items (highest priority) with built-in
 * defaults that match common patterns. Built-in defaults are skipped if a
 * stored guide already covers the same area.
 */
export function guidedTroubleshootingSteps(input: RelevanceInput): GuidedStepGroup[] {
  const ctx = buildContext(input);
  const out: GuidedStepGroup[] = [];

  const stored = knowledgeStore.listByType("troubleshooting_guide");
  const usedTitles = new Set<string>();
  for (const guide of stored) {
    const { score } = scoreItem(guide as AnyKnowledgeItem, ctx);
    if (score < 4) continue;
    out.push({
      sourceId: guide.id,
      title: guide.title,
      steps: guide.content.steps,
      warnings: guide.content.warnings,
      questions: guide.content.questions,
    });
    usedTitles.add(guide.title.toLowerCase());
  }

  for (const builtin of BUILTIN_GUIDES) {
    if (!builtin.match(ctx)) continue;
    if (usedTitles.has(builtin.title.toLowerCase())) continue;
    out.push({
      sourceId: "",
      title: builtin.title,
      steps: builtin.steps,
      warnings: builtin.warnings,
      questions: builtin.questions,
    });
  }

  return out;
}

/**
 * Knowledge-aware additions to the Suggested Questions list. Returns
 * questions sourced from troubleshooting_guide entries plus built-in
 * defaults that match the current call. The caller dedupes against the
 * existing Suggested Questions list.
 */
export function knowledgeDrivenQuestions(input: RelevanceInput): string[] {
  const groups = guidedTroubleshootingSteps(input);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const q of g.questions) {
      const key = q.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
  }
  return out;
}

/**
 * Suggested part-request label and reason if a stored part_request_rule
 * matches the current call. Excludes any rule whose excludePhrases appear
 * in the haystack (eg. "fixed by power drain").
 */
export function partRequestSuggestion(
  input: RelevanceInput,
): PartRequestSuggestion | null {
  const ctx = buildContext(input);
  const rules = knowledgeStore.listByType("part_request_rule");
  let best: { rule: KnowledgeItem<"part_request_rule">; score: number } | null = null;
  for (const rule of rules) {
    if (rule.content.excludePhrases.some((p) => p && ctx.haystack.includes(p.toLowerCase()))) {
      continue;
    }
    const matchesCategory = !rule.content.category || eq(rule.content.category, ctx.category);
    const matchesDevice =
      !rule.content.deviceType ||
      eq(rule.content.deviceType, ctx.deviceType) ||
      ctx.devices.some((d) => eq(d, rule.content.deviceType ?? ""));
    if (!matchesCategory || !matchesDevice) continue;
    if (!any(ctx.haystack, rule.content.triggerPhrases)) continue;
    let score = 1;
    if (matchesCategory && rule.content.category) score += 2;
    if (matchesDevice && rule.content.deviceType) score += 2;
    if (ctx.partNeeded) score += 1;
    if (!best || score > best.score) best = { rule, score };
  }
  if (!best) return null;
  return {
    partLabel: best.rule.content.partLabel,
    reason: best.rule.content.reason,
    sourceId: best.rule.id,
  };
}

/**
 * Convenience helper: matching tickets from a knowledge item's
 * relatedTicketIds list. Used by the Knowledge Base page's "View related
 * tickets" expansion.
 */
export function getRelatedTicketIdsFromItem(item: AnyKnowledgeItem): string[] {
  const ids = (item.content as { relatedTicketIds?: unknown }).relatedTicketIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((x): x is string => typeof x === "string");
}
