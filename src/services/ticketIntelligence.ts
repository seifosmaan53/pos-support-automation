import type { ExtractedDetails, SavedTicket } from "../types/ticket";
import type { ResolutionStatus, TicketFeedback } from "../types/feedback";
import { ticketStore } from "./databaseService";
import { ticketFeedbackStore } from "./ticketFeedbackStore";

export interface IssueFrequency {
  key: string;
  label: string;
  count: number;
  /** Optional sub-metric used by ratio cards (escalation/replacement %). */
  ratio?: number;
}

export interface RepeatedStoreProblem {
  store: string;
  count: number;
  topIssue: string;
}

export interface ResolutionSuccessRate {
  worked: number;
  didNotWork: number;
  total: number;
  /** worked / (worked + didNotWork). 0 when no feedback yet. */
  rate: number;
}

export interface IntelligenceReport {
  totalTickets: number;
  /**
   * Phase 5 low-data threshold. The page uses this to render the "Limited
   * ticket history. Suggestions may be less accurate." banner instead of
   * pretending the report is statistically meaningful.
   */
  isLowData: boolean;

  topCategories: IssueFrequency[];
  topStores: IssueFrequency[];
  topDevices: IssueFrequency[];
  topResolutions: IssueFrequency[];
  partsRequested: IssueFrequency[];
  resolvedCount: number;
  escalatedCount: number;
  partsNeededCount: number;
  pendingCount: number;
  missingFieldCounts: IssueFrequency[];

  // ── Phase 5: feedback-aware analytics ──────────────────────────────
  repeatedStoreProblems: RepeatedStoreProblem[];
  commonAIMissed: IssueFrequency[];
  resolutionSuccessRate: ResolutionSuccessRate;
  /** Categories sorted by escalation ratio (count >= 2 to qualify). */
  escalationProneIssues: IssueFrequency[];
  /** Categories sorted by part-replacement ratio (count >= 2 to qualify). */
  replacementProneIssues: IssueFrequency[];
  /** Free-text "Create a knowledge item for ..." recommendations. */
  knowledgeBaseSuggestions: string[];

  insights: string[];
  suggestions: SimilarSuggestion[];
}

export type Confidence = "Low" | "Medium" | "High";

export interface SimilarSuggestion {
  pattern: string;
  suggestion: string;
  confidence: Confidence;
  basedOnCount: number;
  /** Count of similar tickets the user marked Resolution Worked. */
  workedCount: number;
  /** Count marked Did Not Work. */
  didNotWorkCount: number;
  /** Fraction of similar tickets that escalated (0..1). */
  escalationRatio: number;
  /** Fraction that needed a part request (0..1). */
  partRequestRatio: number;
  /** IDs of the nearest tickets — used by "View Related Tickets". */
  relatedTicketIds: string[];
  /** Subjects for inline display. */
  relatedSubjects: string[];
  /** Top missing fields across the similar tickets. */
  commonMissingDetails: string[];
  /** Plain-English warning, eg. "Limited data" or "Confirm before applying". */
  warning?: string;
  /** Kept from Phase 4 so legacy callers still compile. */
  exampleTicketId?: string;
  warningIfEscalation?: string;
}

/** Tickets below this count get the "Limited data" banner. */
const LOW_DATA_THRESHOLD = 5;

export function buildIntelligenceReport(): IntelligenceReport {
  const tickets = ticketStore.list();
  const feedback = safeFeedbackList();
  const feedbackByTicket = indexFeedbackByTicket(feedback);

  if (tickets.length === 0) {
    return emptyReport();
  }

  const categoryCount = new Map<string, number>();
  const categoryEscalations = new Map<string, number>();
  const categoryReplacements = new Map<string, number>();
  const storeCount = new Map<string, number>();
  const storeIssues = new Map<string, Map<string, number>>();
  const deviceCount = new Map<string, number>();
  const resolutionPatternCount = new Map<string, number>();
  const partsCount = new Map<string, number>();
  const missingFieldCount = new Map<string, number>();
  const aiMissedCount = new Map<string, number>();

  let resolvedCount = 0;
  let escalatedCount = 0;
  let partsNeededCount = 0;
  let pendingCount = 0;
  let resolutionWorked = 0;
  let resolutionDidNotWork = 0;

  for (const t of tickets) {
    const cat = t.details.category?.trim() || "";
    if (cat) {
      bump(categoryCount, cat);
      if (t.details.escalationNeeded || t.details.result === "Escalated") {
        bump(categoryEscalations, cat);
      }
      if (t.details.partNeeded) bump(categoryReplacements, cat);
    }
    if (t.details.storeNumber) {
      bump(storeCount, t.details.storeNumber);
      const issueKey =
        t.details.category?.trim() || firstSignificantPhrase(t.details.issue) || "Other";
      const inner = storeIssues.get(t.details.storeNumber) ?? new Map<string, number>();
      bump(inner, issueKey);
      storeIssues.set(t.details.storeNumber, inner);
    }
    for (const d of t.details.devices) bump(deviceCount, d);
    if (t.details.deviceType && t.details.devices.length === 0)
      bump(deviceCount, t.details.deviceType);
    if (t.details.partNeeded && t.ticketFields?.partRequest) {
      const part =
        t.details.deviceType ||
        t.details.devices[0] ||
        t.details.parts[0] ||
        "unspecified";
      bump(partsCount, part);
    }
    if (t.details.result === "Resolved") resolvedCount++;
    if (t.details.result === "Escalated") escalatedCount++;
    if (t.details.result === "PartsNeeded") partsNeededCount++;
    if (t.details.result === "Pending") pendingCount++;

    const resolutionFingerprint = fingerprintResolution(t);
    if (resolutionFingerprint) bump(resolutionPatternCount, resolutionFingerprint);

    for (const m of t.details.missingInfo) {
      const cleaned = m.split(".")[0].replace(/[A-Z]/g, (c) => c.toLowerCase());
      bump(missingFieldCount, cleaned);
    }

    // Feedback signal — folds resolution-worked counts and AI-missed text.
    const fb = feedbackByTicket.get(t.id) ?? [];
    for (const row of fb) {
      if (row.resolutionWorked === "worked") resolutionWorked++;
      else if (row.resolutionWorked === "did-not-work") resolutionDidNotWork++;
      const note = row.whatAiMissed?.trim();
      if (note) bump(aiMissedCount, condenseNote(note));
      for (const fc of row.correctedFields) {
        if (fc.field && fc.before && fc.after && fc.before !== fc.after) {
          bump(aiMissedCount, `${fc.field}: ${shorten(fc.before, 40)}→${shorten(fc.after, 40)}`);
        }
      }
    }
  }

  const topCategories = topN(categoryCount, 5);
  const topStores = topN(storeCount, 5);
  const topDevices = topN(deviceCount, 5);
  const topResolutions = topN(resolutionPatternCount, 5);
  const partsRequested = topN(partsCount, 5);
  const missingFieldCounts = topN(missingFieldCount, 5);
  const commonAIMissed = topN(aiMissedCount, 5);

  const escalationProneIssues = ratioRanked(categoryCount, categoryEscalations, 5);
  const replacementProneIssues = ratioRanked(categoryCount, categoryReplacements, 5);

  const repeatedStoreProblems: RepeatedStoreProblem[] = [...storeCount.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([store, n]) => {
      const inner = storeIssues.get(store);
      const top = inner
        ? [...inner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
        : "";
      return { store, count: n, topIssue: top };
    });

  const totalFeedback = resolutionWorked + resolutionDidNotWork;
  const resolutionSuccessRate: ResolutionSuccessRate = {
    worked: resolutionWorked,
    didNotWork: resolutionDidNotWork,
    total: totalFeedback,
    rate: totalFeedback > 0 ? resolutionWorked / totalFeedback : 0,
  };

  const knowledgeBaseSuggestions = buildKnowledgeBaseSuggestions({
    topResolutions,
    topDevices,
    commonAIMissed,
    replacementProneIssues,
  });

  const insights: string[] = buildInsights({
    tickets,
    topCategories,
    topResolutions,
    partsRequested,
    missingFieldCounts,
    pendingCount,
    escalatedCount,
    resolutionSuccessRate,
  });

  return {
    totalTickets: tickets.length,
    isLowData: tickets.length < LOW_DATA_THRESHOLD,
    topCategories,
    topStores,
    topDevices,
    topResolutions,
    partsRequested,
    resolvedCount,
    escalatedCount,
    partsNeededCount,
    pendingCount,
    missingFieldCounts,
    repeatedStoreProblems,
    commonAIMissed,
    resolutionSuccessRate,
    escalationProneIssues,
    replacementProneIssues,
    knowledgeBaseSuggestions,
    insights,
    suggestions: [],
  };
}

function emptyReport(): IntelligenceReport {
  return {
    totalTickets: 0,
    isLowData: true,
    topCategories: [],
    topStores: [],
    topDevices: [],
    topResolutions: [],
    partsRequested: [],
    resolvedCount: 0,
    escalatedCount: 0,
    partsNeededCount: 0,
    pendingCount: 0,
    missingFieldCounts: [],
    repeatedStoreProblems: [],
    commonAIMissed: [],
    resolutionSuccessRate: { worked: 0, didNotWork: 0, total: 0, rate: 0 },
    escalationProneIssues: [],
    replacementProneIssues: [],
    knowledgeBaseSuggestions: [],
    insights: ["No saved tickets yet. Save some tickets to start learning."],
    suggestions: [],
  };
}

function buildInsights(args: {
  tickets: SavedTicket[];
  topCategories: IssueFrequency[];
  topResolutions: IssueFrequency[];
  partsRequested: IssueFrequency[];
  missingFieldCounts: IssueFrequency[];
  pendingCount: number;
  escalatedCount: number;
  resolutionSuccessRate: ResolutionSuccessRate;
}): string[] {
  const out: string[] = [];

  if (args.topCategories[0]) {
    const c = args.topCategories[0];
    out.push(
      `Top issue category: ${c.label} (${c.count} ticket${c.count === 1 ? "" : "s"}).`,
    );
  }
  if (args.topResolutions[0] && args.topResolutions[0].count >= 2) {
    out.push(
      `Most common resolution pattern: ${args.topResolutions[0].label} (used in ${args.topResolutions[0].count} ticket${args.topResolutions[0].count === 1 ? "" : "s"}).`,
    );
  }
  if (args.partsRequested[0]) {
    const p = args.partsRequested[0];
    out.push(
      `Most requested part: ${p.label} (${p.count} replacement${p.count === 1 ? "" : "s"}).`,
    );
  }
  if (args.missingFieldCounts[0]) {
    const m = args.missingFieldCounts[0];
    out.push(
      `Most common missing detail: "${m.label}" (${m.count} ticket${m.count === 1 ? "" : "s"}). Consider asking earlier in the call.`,
    );
  }
  if (args.escalatedCount > 0) {
    out.push(
      `${args.escalatedCount} ticket${args.escalatedCount === 1 ? "" : "s"} required escalation.`,
    );
  }
  if (args.pendingCount > 0) {
    out.push(
      `${args.pendingCount} ticket${args.pendingCount === 1 ? "" : "s"} are still pending follow-up.`,
    );
  }
  if (args.resolutionSuccessRate.total > 0) {
    const pct = Math.round(args.resolutionSuccessRate.rate * 100);
    out.push(
      `Confirmed resolution success rate: ${pct}% (${args.resolutionSuccessRate.worked} worked / ${args.resolutionSuccessRate.didNotWork} did not work, based on user feedback).`,
    );
  }
  return out;
}

function buildKnowledgeBaseSuggestions(args: {
  topResolutions: IssueFrequency[];
  topDevices: IssueFrequency[];
  commonAIMissed: IssueFrequency[];
  replacementProneIssues: IssueFrequency[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  for (const r of args.topResolutions) {
    if (r.count >= 3) push(`Create a knowledge item for "${r.label}" (used ${r.count}×).`);
  }
  for (const d of args.topDevices) {
    if (d.count >= 3) push(`Create a knowledge item for ${d.label} troubleshooting (${d.count} tickets).`);
  }
  for (const c of args.replacementProneIssues) {
    if (c.count >= 2 && (c.ratio ?? 0) >= 0.5) {
      push(
        `Create a knowledge item for ${c.label} replacement criteria (${Math.round((c.ratio ?? 0) * 100)}% needed parts).`,
      );
    }
  }
  for (const m of args.commonAIMissed) {
    if (m.count >= 2) push(`Document recurring detail the AI keeps missing: ${m.label}.`);
  }
  return out.slice(0, 8);
}

function fingerprintResolution(t: SavedTicket): string {
  const tags: string[] = [];
  if (t.details.cacheRenamed) tags.push("rename cache");
  if (t.details.servicesRestarted.includes("Pro services")) tags.push("restart Pro");
  if (t.details.servicesRestarted.includes("COM services")) tags.push("restart COM");
  if (t.details.servicesRestarted.includes("BOS services")) tags.push("restart BOS");
  if (t.details.powerDrainPerformed) tags.push("power drain");
  if (t.details.manualRebootPerformed) tags.push("manual reboot");
  if (t.details.cablesReseated) tags.push("reseat cables");
  if (t.details.connectionsConfirmed) tags.push("confirm connections");
  if (t.details.partNeeded) tags.push("replacement");
  if (tags.length === 0) return "";
  return tags.join(" + ");
}

/**
 * Phase 5: rich similar-ticket scoring. Accepts either an ExtractedDetails
 * object (preferred — uses category/device/result/error) or a raw transcript
 * string (legacy fallback for callers that haven't analyzed yet).
 */
export function suggestSolutionsForCurrent(
  input: string | { details: Partial<ExtractedDetails>; transcript?: string },
): SimilarSuggestion[] {
  const tickets = ticketStore.list();
  if (tickets.length === 0) return [];
  const feedback = safeFeedbackList();
  const feedbackByTicket = indexFeedbackByTicket(feedback);

  // Normalize input.
  const details: Partial<ExtractedDetails> | null =
    typeof input === "string" ? null : input.details;
  const transcript = typeof input === "string" ? input : input.transcript ?? "";

  if (!details && !transcript.trim()) return [];

  const matches: { ticket: SavedTicket; score: number }[] = [];
  const lowerTranscript = transcript.toLowerCase();

  for (const t of tickets) {
    let score = 0;
    if (details) {
      if (details.category && t.details.category && eq(details.category, t.details.category))
        score += 3;
      if (details.subCategory && t.details.subCategory && eq(details.subCategory, t.details.subCategory))
        score += 2;
      if (details.deviceType && t.details.deviceType && eq(details.deviceType, t.details.deviceType))
        score += 2;
      if (details.devices?.length && t.details.devices?.length) {
        const overlap = details.devices.filter((d) =>
          t.details.devices.some((d2) => eq(d, d2)),
        ).length;
        score += Math.min(overlap, 2) * 2;
      }
      if (details.result && t.details.result && details.result === t.details.result) score += 1;
      if (details.errorMessage && t.details.errorMessage) {
        const a = details.errorMessage.toLowerCase();
        const b = t.details.errorMessage.toLowerCase();
        if (a && b && (a.includes(b) || b.includes(a))) score += 3;
      }
      if (details.storeNumber && t.details.storeNumber === details.storeNumber) score += 1;
      if (details.partNeeded === true && t.details.partNeeded === true) score += 1;
      if (details.issue && t.details.issue) {
        score += keywordOverlapScore(details.issue, t.details.issue);
      }
    }
    if (transcript) {
      if (t.details.category && lowerTranscript.includes(t.details.category.toLowerCase()))
        score += 1;
      if (t.details.deviceType && lowerTranscript.includes(t.details.deviceType.toLowerCase()))
        score += 1;
      if (t.details.errorMessage && lowerTranscript.includes(t.details.errorMessage.toLowerCase()))
        score += 2;
      const w = firstSignificantWord(t.details.issue);
      if (w && lowerTranscript.includes(w)) score += 1;
    }
    if (score > 0) matches.push({ ticket: t, score });
  }

  if (matches.length === 0) return [];
  matches.sort((a, b) => b.score - a.score);

  // Bucket the top matches by resolution fingerprint and aggregate stats.
  const buckets = new Map<
    string,
    { tickets: SavedTicket[]; topScore: number }
  >();
  for (const m of matches.slice(0, 12)) {
    const fp = fingerprintResolution(m.ticket);
    if (!fp) continue;
    const existing = buckets.get(fp);
    if (existing) {
      existing.tickets.push(m.ticket);
    } else {
      buckets.set(fp, { tickets: [m.ticket], topScore: m.score });
    }
  }

  const suggestions: SimilarSuggestion[] = [];
  for (const [pattern, bucket] of buckets.entries()) {
    let workedCount = 0;
    let didNotWorkCount = 0;
    let escalations = 0;
    let parts = 0;
    const missingTally = new Map<string, number>();
    const subjects: string[] = [];
    const ids: string[] = [];

    for (const tk of bucket.tickets) {
      ids.push(tk.id);
      if (tk.ticketFields?.subject) subjects.push(tk.ticketFields.subject);
      if (tk.details.escalationNeeded || tk.details.result === "Escalated") escalations++;
      if (tk.details.partNeeded) parts++;
      for (const m of tk.details.missingInfo ?? []) {
        const k = m.split(".")[0].replace(/[A-Z]/g, (c) => c.toLowerCase());
        bump(missingTally, k);
      }
      const fb = feedbackByTicket.get(tk.id) ?? [];
      for (const row of fb) {
        if (row.resolutionWorked === "worked") workedCount++;
        else if (row.resolutionWorked === "did-not-work") didNotWorkCount++;
      }
    }

    const basedOnCount = bucket.tickets.length;
    const escalationRatio = basedOnCount === 0 ? 0 : escalations / basedOnCount;
    const partRequestRatio = basedOnCount === 0 ? 0 : parts / basedOnCount;
    const confidence = decideConfidence({
      basedOnCount,
      workedCount,
      didNotWorkCount,
    });

    const commonMissingDetails = [...missingTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);

    const warning = buildSuggestionWarning({
      basedOnCount,
      didNotWorkCount,
      workedCount,
      escalationRatio,
    });

    suggestions.push({
      pattern,
      suggestion: phraseSuggestion(pattern),
      confidence,
      basedOnCount,
      workedCount,
      didNotWorkCount,
      escalationRatio,
      partRequestRatio,
      relatedTicketIds: ids.slice(0, 5),
      relatedSubjects: dedupe(subjects).slice(0, 5),
      commonMissingDetails,
      warning,
      exampleTicketId: bucket.tickets[0].id,
      warningIfEscalation:
        escalations > 0 && escalations >= basedOnCount / 2
          ? `${escalations} similar tickets were escalated.`
          : undefined,
    });
  }

  // Confidence first, then sample size — High recommendations should never be
  // buried under a noisy Low pattern just because the Low one had more hits.
  suggestions.sort((a, b) => {
    const ca = confidenceWeight(a.confidence);
    const cb = confidenceWeight(b.confidence);
    if (ca !== cb) return cb - ca;
    return b.basedOnCount - a.basedOnCount;
  });
  return suggestions.slice(0, 4);
}

function decideConfidence(args: {
  basedOnCount: number;
  workedCount: number;
  didNotWorkCount: number;
}): Confidence {
  const { basedOnCount, workedCount, didNotWorkCount } = args;
  const net = workedCount - didNotWorkCount;
  // Strong negative feedback always demotes — even on lots of past tickets.
  if (didNotWorkCount > workedCount && didNotWorkCount >= 2) return "Low";
  if (basedOnCount >= 4 && net >= 0) return "High";
  if (basedOnCount >= 2) {
    if (net >= 1) return "High";
    return "Medium";
  }
  if (workedCount >= 2 && didNotWorkCount === 0) return "Medium";
  return "Low";
}

function confidenceWeight(c: Confidence): number {
  if (c === "High") return 3;
  if (c === "Medium") return 2;
  return 1;
}

function buildSuggestionWarning(args: {
  basedOnCount: number;
  didNotWorkCount: number;
  workedCount: number;
  escalationRatio: number;
}): string | undefined {
  if (args.basedOnCount < 2) return "Limited data — only 1 similar ticket found.";
  if (args.didNotWorkCount > args.workedCount && args.didNotWorkCount >= 2)
    return "User feedback shows this resolution often did not work — review carefully.";
  if (args.escalationRatio >= 0.5)
    return "Half or more of similar tickets were escalated — confirm before applying.";
  return undefined;
}

function phraseSuggestion(pattern: string): string {
  // Same pattern label is used as the action — phrased as "based on similar
  // previous tickets" to set expectations. Never says "this will fix it".
  return `Suggested based on similar previous tickets: ${pattern}.`;
}

function safeFeedbackList(): TicketFeedback[] {
  try {
    return ticketFeedbackStore.list();
  } catch {
    return [];
  }
}

function indexFeedbackByTicket(rows: TicketFeedback[]): Map<string, TicketFeedback[]> {
  const map = new Map<string, TicketFeedback[]>();
  for (const r of rows) {
    const list = map.get(r.ticketId) ?? [];
    list.push(r);
    map.set(r.ticketId, list);
  }
  return map;
}

function bump(map: Map<string, number>, key: string): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topN(map: Map<string, number>, n: number): IssueFrequency[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ key: k, label: k, count: v }));
}

/**
 * Rank by ratio (occurrences / parent count) but require the parent to have
 * fired at least twice so a single noisy ticket doesn't dominate.
 */
function ratioRanked(
  parent: Map<string, number>,
  numerator: Map<string, number>,
  n: number,
): IssueFrequency[] {
  const out: IssueFrequency[] = [];
  for (const [k, total] of parent.entries()) {
    if (total < 2) continue;
    const num = numerator.get(k) ?? 0;
    if (num === 0) continue;
    out.push({ key: k, label: k, count: num, ratio: num / total });
  }
  out.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  return out.slice(0, n);
}

function eq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function firstSignificantWord(s: string): string {
  if (!s) return "";
  const words = s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5);
  return words[0] ?? "";
}

function firstSignificantPhrase(s: string): string {
  if (!s) return "";
  const cleaned = s.trim().replace(/\s+/g, " ");
  return cleaned.length > 60 ? cleaned.slice(0, 60) + "…" : cleaned;
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

function keywordOverlapScore(a: string, b: string): number {
  const ka = tokenize(a);
  const kb = new Set(tokenize(b));
  let overlap = 0;
  for (const k of ka) if (kb.has(k)) overlap++;
  return Math.min(overlap, 3);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function condenseNote(note: string): string {
  const cleaned = note.replace(/\s+/g, " ").trim();
  return shorten(cleaned, 80);
}

/** Convenience helper for the panel: get full SavedTicket records by id. */
export function getRelatedTickets(ids: string[]): SavedTicket[] {
  const out: SavedTicket[] = [];
  for (const id of ids) {
    const t = ticketStore.get(id);
    if (t) out.push(t);
  }
  return out;
}
