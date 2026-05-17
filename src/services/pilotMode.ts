/**
 * Phase 16 — Pilot Mode state.
 *
 * Three concerns live here:
 *   1. Daily event counters — every meaningful action (ticket saved, audio
 *      attached, copy mode used, etc.) increments a bucket keyed by the
 *      local date. Aggregations: today / week / all.
 *   2. Per-ticket quick-feedback tags — eleven toggleable flags (good
 *      output, needs correction, bad transcript, etc.) so the Pilot Week
 *      Report can show "X tickets needed correction this week" without
 *      asking the user to write prose.
 *   3. Tuning queue — a small bug-tracker keyed by 11 categories. Different
 *      from the Smoke Test Issues list because pilot-queue items are
 *      bottom-up observations from real calls, not top-down checklist
 *      failures.
 *
 * Everything lives in localStorage. No SQLite migration — pilot data is
 * disposable telemetry; if the user wipes it, the app keeps working.
 */

// ────────────────────────────────────────────────────────────────────────────
// Event counters
// ────────────────────────────────────────────────────────────────────────────

export type PilotEventType =
  | "ticketCreated"
  | "recordingSaved"
  | "recordingAttached"
  | "ticketCopiedWithCopyMode"
  | "ticketSavedWithoutAudio"
  | "liveTranscriptUsed"
  | "finalTranscriptUsed"
  | "reTranscribed"
  | "manualCorrection"
  | "speakerCorrection"
  | "callerNameCorrection"
  | "aiMissedDetailReported"
  | "smokeTestFailure"
  | "criticalIssueOpened";

export const PILOT_EVENT_LABELS: Record<PilotEventType, string> = {
  ticketCreated: "Tickets created",
  recordingSaved: "Recordings saved",
  recordingAttached: "Recordings attached",
  ticketCopiedWithCopyMode: "Tickets copied with Copy Mode",
  ticketSavedWithoutAudio: "Tickets saved without audio",
  liveTranscriptUsed: "Live transcripts used",
  finalTranscriptUsed: "Final transcripts used",
  reTranscribed: "Re-transcriptions",
  manualCorrection: "Manual corrections",
  speakerCorrection: "Speaker corrections",
  callerNameCorrection: "Caller name corrections",
  aiMissedDetailReported: "AI missed detail reports",
  smokeTestFailure: "Failed smoke-test issues",
  criticalIssueOpened: "Open critical issues",
};

export const PILOT_EVENT_TYPES: PilotEventType[] = Object.keys(
  PILOT_EVENT_LABELS,
) as PilotEventType[];

interface PilotDailyBucket {
  /** Local YYYY-MM-DD. */
  date: string;
  counts: Partial<Record<PilotEventType, number>>;
}

const LS_EVENTS_KEY = "sta.pilot.events.v1";
const LS_TAGS_KEY = "sta.pilot.tags.v1";
const LS_QUEUE_KEY = "sta.pilot.queue.v1";
const LS_START_KEY = "sta.pilot.startedAt";

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loadBuckets(): PilotDailyBucket[] {
  const raw = readJson<PilotDailyBucket[]>(LS_EVENTS_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

function saveBuckets(buckets: PilotDailyBucket[]): void {
  writeJson(LS_EVENTS_KEY, buckets);
}

export function getPilotStartedAt(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(LS_START_KEY);
  } catch {
    return null;
  }
}

function ensurePilotStartedAt(): void {
  if (typeof localStorage === "undefined") return;
  if (!getPilotStartedAt()) {
    try {
      localStorage.setItem(LS_START_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
  }
}

/**
 * Increment a counter for today. Pure side effect — never throws. The
 * first event in the pilot also stamps the pilot-start date so the
 * "This week" window has an anchor.
 */
export function recordPilotEvent(type: PilotEventType, by = 1): void {
  ensurePilotStartedAt();
  const today = localDate();
  const buckets = loadBuckets();
  let bucket = buckets.find((b) => b.date === today);
  if (!bucket) {
    bucket = { date: today, counts: {} };
    buckets.push(bucket);
  }
  bucket.counts[type] = (bucket.counts[type] ?? 0) + by;
  saveBuckets(buckets);
}

export type PilotPeriod = "today" | "week" | "all";

export type PilotCounts = Record<PilotEventType, number>;

function emptyCounts(): PilotCounts {
  const out = {} as PilotCounts;
  for (const t of PILOT_EVENT_TYPES) out[t] = 0;
  return out;
}

function withinWeek(date: string, today: Date): boolean {
  const d = new Date(`${date}T00:00:00`);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);
  return d.getTime() >= cutoff.getTime();
}

/**
 * Get the aggregated counts for a given period.
 *   today: just today's bucket
 *   week:  last 7 calendar days including today
 *   all:   every recorded bucket
 */
export function getPilotCounts(period: PilotPeriod = "today"): PilotCounts {
  const buckets = loadBuckets();
  const today = new Date();
  const todayKey = localDate(today);
  const result = emptyCounts();
  for (const b of buckets) {
    if (period === "today" && b.date !== todayKey) continue;
    if (period === "week" && !withinWeek(b.date, today)) continue;
    for (const t of PILOT_EVENT_TYPES) {
      result[t] += b.counts[t] ?? 0;
    }
  }
  return result;
}

export function getPilotDaysActive(): number {
  return loadBuckets().length;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-ticket quick-feedback tags
// ────────────────────────────────────────────────────────────────────────────

export type FeedbackTag =
  | "goodOutput"
  | "needsCorrection"
  | "badTranscript"
  | "wrongSpeakerLabels"
  | "wrongCallerName"
  | "missingFields"
  | "badDescription"
  | "badResolution"
  | "badPartRequest"
  | "copyModeIssue"
  | "audioIssue";

export const FEEDBACK_TAG_LABELS: Record<FeedbackTag, string> = {
  goodOutput: "Good output",
  needsCorrection: "Needs correction",
  badTranscript: "Bad transcript",
  wrongSpeakerLabels: "Wrong speaker labels",
  wrongCallerName: "Wrong caller name",
  missingFields: "Missing store/register/device",
  badDescription: "Bad description",
  badResolution: "Bad resolution",
  badPartRequest: "Bad part request",
  copyModeIssue: "Copy Mode issue",
  audioIssue: "Audio issue",
};

export const FEEDBACK_TAGS: FeedbackTag[] = Object.keys(
  FEEDBACK_TAG_LABELS,
) as FeedbackTag[];

export interface PilotTicketFeedback {
  ticketId: string;
  tags: FeedbackTag[];
  notes: string;
  updatedAt: string;
}

type PilotTagStore = Record<string, PilotTicketFeedback>;

function loadTags(): PilotTagStore {
  return readJson<PilotTagStore>(LS_TAGS_KEY, {});
}

function saveTags(s: PilotTagStore): void {
  writeJson(LS_TAGS_KEY, s);
}

export function getTicketFeedback(ticketId: string): PilotTicketFeedback {
  return (
    loadTags()[ticketId] ?? {
      ticketId,
      tags: [],
      notes: "",
      updatedAt: "",
    }
  );
}

export function toggleTicketTag(
  ticketId: string,
  tag: FeedbackTag,
): PilotTicketFeedback {
  const store = loadTags();
  const existing = store[ticketId] ?? {
    ticketId,
    tags: [] as FeedbackTag[],
    notes: "",
    updatedAt: "",
  };
  const has = existing.tags.includes(tag);
  const nextTags = has
    ? existing.tags.filter((t) => t !== tag)
    : [...existing.tags, tag];
  const next: PilotTicketFeedback = {
    ticketId,
    tags: nextTags,
    notes: existing.notes,
    updatedAt: new Date().toISOString(),
  };
  store[ticketId] = next;
  saveTags(store);
  // Roll up to the corresponding aggregate counter so the Pilot Report
  // surfaces "AI missed detail" / "needs correction" without re-walking the
  // tag store. Toggling OFF doesn't decrement — the daily counter is "events
  // observed", not "issues currently active".
  if (!has) {
    if (tag === "needsCorrection" || tag === "missingFields") {
      recordPilotEvent("aiMissedDetailReported");
    }
    if (tag === "wrongSpeakerLabels") recordPilotEvent("speakerCorrection");
    if (tag === "wrongCallerName") recordPilotEvent("callerNameCorrection");
  }
  return next;
}

export function setTicketFeedbackNotes(
  ticketId: string,
  notes: string,
): PilotTicketFeedback {
  const store = loadTags();
  const existing = store[ticketId] ?? {
    ticketId,
    tags: [] as FeedbackTag[],
    notes: "",
    updatedAt: "",
  };
  const next: PilotTicketFeedback = {
    ticketId,
    tags: existing.tags,
    notes,
    updatedAt: new Date().toISOString(),
  };
  store[ticketId] = next;
  saveTags(store);
  return next;
}

export function listTicketFeedback(): PilotTicketFeedback[] {
  const store = loadTags();
  return Object.values(store).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tuning queue
// ────────────────────────────────────────────────────────────────────────────

export type TuningCategory =
  | "transcription"
  | "speakerDetection"
  | "callerName"
  | "storeRegisterDetection"
  | "descriptionWriting"
  | "resolutionWriting"
  | "partRequestLogic"
  | "copyMode"
  | "audioAttachment"
  | "backupRestore"
  | "uiConfusion";

export const TUNING_CATEGORY_LABELS: Record<TuningCategory, string> = {
  transcription: "Transcription",
  speakerDetection: "Speaker Detection",
  callerName: "Caller Name",
  storeRegisterDetection: "Store/Register Detection",
  descriptionWriting: "Description Writing",
  resolutionWriting: "Resolution Writing",
  partRequestLogic: "Part Request Logic",
  copyMode: "Copy Mode",
  audioAttachment: "Audio Attachment",
  backupRestore: "Backup/Restore",
  uiConfusion: "UI Confusion",
};

export const TUNING_CATEGORIES = Object.keys(
  TUNING_CATEGORY_LABELS,
) as TuningCategory[];

export type TuningSeverity = "critical" | "high" | "medium" | "low";
export type TuningStatus = "open" | "fixed" | "ignored";

export interface TuningItem {
  id: string;
  title: string;
  category: TuningCategory;
  severity: TuningSeverity;
  ticketId?: string;
  notes: string;
  status: TuningStatus;
  createdAt: string;
  updatedAt: string;
}

function loadQueue(): TuningItem[] {
  return readJson<TuningItem[]>(LS_QUEUE_KEY, []);
}

function saveQueue(items: TuningItem[]): void {
  writeJson(LS_QUEUE_KEY, items);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function listTuningItems(): TuningItem[] {
  return loadQueue().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addTuningItem(input: {
  title: string;
  category: TuningCategory;
  severity?: TuningSeverity;
  ticketId?: string;
  notes?: string;
}): TuningItem {
  const item: TuningItem = {
    id: newId("tune"),
    title: input.title || "(untitled)",
    category: input.category,
    severity: input.severity ?? "medium",
    ticketId: input.ticketId,
    notes: input.notes ?? "",
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const next = [item, ...loadQueue()];
  saveQueue(next);
  if (item.severity === "critical" || item.severity === "high") {
    recordPilotEvent("criticalIssueOpened");
  }
  return item;
}

export function updateTuningItem(
  id: string,
  patch: Partial<Omit<TuningItem, "id" | "createdAt">>,
): TuningItem | null {
  const all = loadQueue();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const next: TuningItem = {
    ...all[i],
    ...patch,
    id: all[i].id,
    createdAt: all[i].createdAt,
    updatedAt: new Date().toISOString(),
  };
  all[i] = next;
  saveQueue(all);
  return next;
}

export function removeTuningItem(id: string): void {
  saveQueue(loadQueue().filter((i) => i.id !== id));
}

// ────────────────────────────────────────────────────────────────────────────
// Daily checklist (state-only, persisted by date)
// ────────────────────────────────────────────────────────────────────────────

export type DailyChecklistStage = "before" | "during" | "after";

export interface DailyChecklistItem {
  id: string;
  stage: DailyChecklistStage;
  label: string;
}

export const DAILY_CHECKLIST: DailyChecklistItem[] = [
  { id: "system-health-ok", stage: "before", label: "System Health OK" },
  { id: "backup-exists", stage: "before", label: "Backup exists" },
  { id: "audio-health-clean", stage: "before", label: "Audio health clean" },
  { id: "whisper-configured", stage: "before", label: "Whisper configured" },
  { id: "microphone-working", stage: "before", label: "Microphone working" },
  { id: "no-critical-errors", stage: "before", label: "Error log has no critical errors" },

  { id: "record-test-call", stage: "during", label: "Record at least one test call" },
  { id: "confirm-live-transcript", stage: "during", label: "Confirm live transcript appears" },
  { id: "confirm-audio-attaches", stage: "during", label: "Confirm audio attaches" },
  { id: "confirm-copy-mode", stage: "during", label: "Confirm Copy Mode works" },

  { id: "export-backup-audio", stage: "after", label: "Export Backup + Audio" },
  { id: "review-failed-tickets", stage: "after", label: "Review failed tickets" },
  { id: "review-corrections", stage: "after", label: "Review corrections" },
  { id: "review-open-issues", stage: "after", label: "Review open smoke-test issues" },
];

const LS_CHECKLIST_KEY = "sta.pilot.checklist.v1";

interface DailyChecklistState {
  date: string;
  /** id → ISO timestamp of when it was checked. */
  checks: Record<string, string>;
}

export function getDailyChecklist(): DailyChecklistState {
  const raw = readJson<DailyChecklistState | null>(LS_CHECKLIST_KEY, null);
  const today = localDate();
  if (!raw || raw.date !== today) {
    // Fresh day — reset the boxes so yesterday's checks don't carry over.
    return { date: today, checks: {} };
  }
  return raw;
}

export function toggleDailyChecklist(id: string): DailyChecklistState {
  const state = getDailyChecklist();
  if (state.checks[id]) {
    delete state.checks[id];
  } else {
    state.checks[id] = new Date().toISOString();
  }
  writeJson(LS_CHECKLIST_KEY, state);
  return state;
}

// ────────────────────────────────────────────────────────────────────────────
// Pilot Week report markdown
// ────────────────────────────────────────────────────────────────────────────

export interface PilotReportInput {
  totalTickets: number;
  totalRecordings: number;
  audioAttachSuccessRate: number;
  mostCommonIssueTypes: { label: string; count: number }[];
  mostCommonStores: { storeNumber: string; count: number }[];
  mostCommonCorrections: { label: string; count: number }[];
  callerNameCorrections: number;
  speakerCorrections: number;
  transcriptCorrections: number;
  ticketsNeedingRework: number;
  openCriticalIssues: number;
  recommendedFixes: string[];
}

export function pilotReportMarkdown(input: PilotReportInput): string {
  const lines: string[] = [];
  lines.push("# Store Ticket Assistant — Pilot Week Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  const started = getPilotStartedAt();
  if (started) {
    lines.push(`Pilot started: ${new Date(started).toLocaleString()}`);
  }
  lines.push(`Days active: ${getPilotDaysActive()}`);
  lines.push("");

  lines.push("## Totals");
  lines.push("");
  lines.push(`- Total tickets: **${input.totalTickets}**`);
  lines.push(`- Total recordings: **${input.totalRecordings}**`);
  lines.push(
    `- Audio attachment success rate: **${(input.audioAttachSuccessRate * 100).toFixed(1)}%**`,
  );
  lines.push(`- Tickets needing rework: **${input.ticketsNeedingRework}**`);
  lines.push(`- Open critical issues: **${input.openCriticalIssues}**`);
  lines.push("");

  lines.push("## Corrections");
  lines.push("");
  lines.push(`- Caller name corrections: ${input.callerNameCorrections}`);
  lines.push(`- Speaker corrections: ${input.speakerCorrections}`);
  lines.push(`- Transcript corrections: ${input.transcriptCorrections}`);
  lines.push("");

  if (input.mostCommonIssueTypes.length > 0) {
    lines.push("## Most common feedback tags");
    lines.push("");
    for (const r of input.mostCommonIssueTypes) {
      lines.push(`- ${r.label}: ${r.count}`);
    }
    lines.push("");
  }

  if (input.mostCommonStores.length > 0) {
    lines.push("## Most common stores");
    lines.push("");
    for (const r of input.mostCommonStores) {
      lines.push(`- Store ${r.storeNumber}: ${r.count} ticket(s)`);
    }
    lines.push("");
  }

  if (input.mostCommonCorrections.length > 0) {
    lines.push("## Most common corrections");
    lines.push("");
    for (const r of input.mostCommonCorrections) {
      lines.push(`- ${r.label}: ${r.count}`);
    }
    lines.push("");
  }

  if (input.recommendedFixes.length > 0) {
    lines.push("## Recommended fixes before full daily use");
    lines.push("");
    for (const f of input.recommendedFixes) lines.push(`- ${f}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Reset hook (tests)
// ────────────────────────────────────────────────────────────────────────────

export function __resetPilotMode(): void {
  if (typeof localStorage === "undefined") return;
  for (const k of [LS_EVENTS_KEY, LS_TAGS_KEY, LS_QUEUE_KEY, LS_START_KEY, LS_CHECKLIST_KEY]) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
}
