/**
 * Phase 14 — Real-World Smoke Test state.
 *
 * Tracks a single in-flight smoke-test run plus a flat list of Issues
 * captured during runs. Everything lives in localStorage so the run
 * survives reloads — a smoke test is something you do in chunks across a
 * shift, not in one sitting.
 *
 * Pure data layer. The page reads via `getCurrentRun()` / `listIssues()`
 * and mutates via the action helpers; the UI is a thin renderer over both.
 */

export type SmokeTestStatus = "pending" | "pass" | "fail" | "skipped";

export interface SmokeTestItem {
  id: string;
  label: string;
}

export interface SmokeTestGroup {
  id: string;
  title: string;
  items: SmokeTestItem[];
}

export interface SmokeTestRecord {
  itemId: string;
  status: SmokeTestStatus;
  notes: string;
  /** ISO timestamp of when this record was last updated. */
  updatedAt: string;
}

export interface SmokeTestRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  records: Record<string, SmokeTestRecord>;
}

export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueStatus = "open" | "fixed" | "wont-fix";

export interface SmokeTestIssue {
  id: string;
  title: string;
  whatHappened: string;
  expected: string;
  actual: string;
  pageSection: string;
  severity: IssueSeverity;
  notes: string;
  /** Item id this issue was reported against, if any. */
  itemId?: string;
  /** Run id this issue was reported during, if any. */
  runId?: string;
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
}

const LS_RUN_KEY = "sta.smoke_test.run.v1";
const LS_ISSUES_KEY = "sta.smoke_test.issues.v1";

// ────────────────────────────────────────────────────────────────────────────
// Checklist seed — mirrors the Phase 14 spec, group-for-group.
// ────────────────────────────────────────────────────────────────────────────

export const SMOKE_TEST_CHECKLIST: SmokeTestGroup[] = [
  {
    id: "setup",
    title: "Setup",
    items: [
      { id: "setup.launch", label: "App launches successfully" },
      { id: "setup.home", label: "Home page loads" },
      { id: "setup.system-health", label: "System Health loads" },
      { id: "setup.backup-exists", label: "Backup exists" },
      { id: "setup.audio-health", label: "Audio health is clean or explained" },
      { id: "setup.whisper", label: "Whisper is configured" },
      { id: "setup.microphone", label: "Microphone works" },
    ],
  },
  {
    id: "new-ticket",
    title: "New Ticket",
    items: [
      { id: "new.record-start", label: "Start recording works" },
      { id: "new.live-transcript", label: "Live transcription appears while recording" },
      { id: "new.speaker-labels", label: "Speaker labels appear" },
      { id: "new.store-number", label: "Store number captured" },
      { id: "new.caller-name", label: "Caller name captured" },
      { id: "new.register", label: "Register number captured" },
      { id: "new.device", label: "Device captured" },
      { id: "new.issue", label: "Issue captured" },
      { id: "new.result", label: "Result captured or warning shown" },
      { id: "new.record-stop", label: "Stop recording works" },
      { id: "new.audio-saved", label: "Audio saved locally" },
      { id: "new.audio-attached", label: "Audio attached to ticket" },
    ],
  },
  {
    id: "ticket-generation",
    title: "Ticket Generation",
    items: [
      { id: "gen.transcript-review", label: "Transcript review works" },
      { id: "gen.speaker-correction", label: "Speaker correction works" },
      { id: "gen.analyze", label: "Analyze transcript works" },
      { id: "gen.subject", label: "Subject generated" },
      { id: "gen.description", label: "Description generated" },
      { id: "gen.resolution", label: "Resolution generated" },
      { id: "gen.additional", label: "Additional comments generated if needed" },
      { id: "gen.part-request", label: "Part request generated only if needed" },
      { id: "gen.natural", label: "Writing sounds natural" },
    ],
  },
  {
    id: "copy-mode",
    title: "Copy Mode",
    items: [
      { id: "copy.opens", label: "Copy Mode opens" },
      { id: "copy.sequence-starts", label: "Field sequence starts" },
      { id: "copy.current-copies", label: "Current field copies" },
      { id: "copy.next-prev", label: "Next/previous works" },
      { id: "copy.skip", label: "Skip field works" },
      { id: "copy.log-saves", label: "Copy log saves" },
    ],
  },
  {
    id: "history",
    title: "History",
    items: [
      { id: "hist.appears", label: "Ticket appears in History" },
      { id: "hist.search", label: "Search finds ticket" },
      { id: "hist.inspect", label: "Inspect opens" },
      { id: "hist.audio-tab", label: "Audio tab shows recording" },
      { id: "hist.versions", label: "Transcript versions show" },
      { id: "hist.copy-log", label: "Copy log shows" },
      { id: "hist.re-transcribe", label: "Re-transcribe works if Whisper configured" },
    ],
  },
  {
    id: "backup",
    title: "Backup",
    items: [
      { id: "backup.export", label: "Export Backup works" },
      { id: "backup.export-audio", label: "Export Backup + Audio works" },
      { id: "backup.verify", label: "Verify Backup works" },
    ],
  },
  {
    id: "final",
    title: "Final",
    items: [
      { id: "final.no-black-screens", label: "No black screens" },
      { id: "final.no-fake-buttons", label: "No fake buttons" },
      { id: "final.no-confusing-errors", label: "No confusing errors" },
      { id: "final.no-missing-audio", label: "No missing audio" },
      { id: "final.no-broken-copy", label: "No broken copy buttons" },
      { id: "final.no-lost-transcript", label: "No lost transcript" },
      { id: "final.no-lost-ticket", label: "No lost ticket" },
    ],
  },
];

export const ALL_SMOKE_TEST_ITEM_IDS = SMOKE_TEST_CHECKLIST.flatMap((g) =>
  g.items.map((i) => i.id),
);

// ────────────────────────────────────────────────────────────────────────────
// Persistence helpers
// ────────────────────────────────────────────────────────────────────────────

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
    // best-effort — the smoke-test page warns separately if storage is full
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Runs
// ────────────────────────────────────────────────────────────────────────────

export function getCurrentRun(): SmokeTestRun | null {
  const r = readJson<SmokeTestRun | null>(LS_RUN_KEY, null);
  if (!r) return null;
  return {
    id: String(r.id ?? newId("run")),
    startedAt: typeof r.startedAt === "string" ? r.startedAt : nowIso(),
    finishedAt:
      typeof r.finishedAt === "string" || r.finishedAt === null ? r.finishedAt : null,
    records: r.records && typeof r.records === "object" ? r.records : {},
  };
}

function persistRun(run: SmokeTestRun): void {
  writeJson(LS_RUN_KEY, run);
}

/**
 * Start a fresh smoke test run. Pending if you had one in flight — the
 * caller is expected to confirm with the user before calling this since
 * it erases mid-run progress.
 */
export function startNewSmokeTest(): SmokeTestRun {
  const run: SmokeTestRun = {
    id: newId("run"),
    startedAt: nowIso(),
    finishedAt: null,
    records: {},
  };
  persistRun(run);
  return run;
}

export function setItemStatus(
  itemId: string,
  status: SmokeTestStatus,
  notes?: string,
): SmokeTestRun {
  let run = getCurrentRun();
  if (!run) run = startNewSmokeTest();
  const existing = run.records[itemId];
  run.records[itemId] = {
    itemId,
    status,
    notes: notes ?? existing?.notes ?? "",
    updatedAt: nowIso(),
  };
  persistRun(run);
  return run;
}

export function setItemNotes(itemId: string, notes: string): SmokeTestRun {
  let run = getCurrentRun();
  if (!run) run = startNewSmokeTest();
  const existing = run.records[itemId];
  run.records[itemId] = {
    itemId,
    status: existing?.status ?? "pending",
    notes,
    updatedAt: nowIso(),
  };
  persistRun(run);
  return run;
}

export function finishSmokeTest(): SmokeTestRun | null {
  const run = getCurrentRun();
  if (!run) return null;
  run.finishedAt = nowIso();
  persistRun(run);
  return run;
}

export function clearSmokeTest(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_RUN_KEY);
  } catch {
    // ignore
  }
}

export interface SmokeTestCounts {
  pass: number;
  fail: number;
  skipped: number;
  pending: number;
  total: number;
}

export function countRun(run: SmokeTestRun | null): SmokeTestCounts {
  let pass = 0;
  let fail = 0;
  let skipped = 0;
  for (const id of ALL_SMOKE_TEST_ITEM_IDS) {
    const r = run?.records[id];
    if (!r || r.status === "pending") continue;
    if (r.status === "pass") pass += 1;
    else if (r.status === "fail") fail += 1;
    else if (r.status === "skipped") skipped += 1;
  }
  const accounted = pass + fail + skipped;
  return {
    pass,
    fail,
    skipped,
    pending: ALL_SMOKE_TEST_ITEM_IDS.length - accounted,
    total: ALL_SMOKE_TEST_ITEM_IDS.length,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Issues
// ────────────────────────────────────────────────────────────────────────────

export function listIssues(): SmokeTestIssue[] {
  return readJson<SmokeTestIssue[]>(LS_ISSUES_KEY, []);
}

function persistIssues(issues: SmokeTestIssue[]): void {
  writeJson(LS_ISSUES_KEY, issues);
}

export function addIssue(input: {
  title: string;
  whatHappened?: string;
  expected?: string;
  actual?: string;
  pageSection?: string;
  severity?: IssueSeverity;
  notes?: string;
  itemId?: string;
  runId?: string;
}): SmokeTestIssue {
  const issue: SmokeTestIssue = {
    id: newId("iss"),
    title: input.title || "(untitled)",
    whatHappened: input.whatHappened ?? "",
    expected: input.expected ?? "",
    actual: input.actual ?? "",
    pageSection: input.pageSection ?? "",
    severity: input.severity ?? "medium",
    notes: input.notes ?? "",
    itemId: input.itemId,
    runId: input.runId,
    status: "open",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const next = [issue, ...listIssues()];
  persistIssues(next);
  return issue;
}

export function updateIssue(
  id: string,
  patch: Partial<Omit<SmokeTestIssue, "id" | "createdAt">>,
): SmokeTestIssue | null {
  const all = listIssues();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const next: SmokeTestIssue = {
    ...all[i],
    ...patch,
    id: all[i].id,
    createdAt: all[i].createdAt,
    updatedAt: nowIso(),
  };
  all[i] = next;
  persistIssues(all);
  return next;
}

export function removeIssue(id: string): void {
  persistIssues(listIssues().filter((i) => i.id !== id));
}

export function countOpenCriticalIssues(): number {
  return listIssues().filter(
    (i) => i.status === "open" && (i.severity === "critical" || i.severity === "high"),
  ).length;
}

// ────────────────────────────────────────────────────────────────────────────
// Report export
// ────────────────────────────────────────────────────────────────────────────

/**
 * Markdown export combining the current run + open issues. Used by the
 * "Export Smoke Test Report" button. We use markdown rather than JSON so
 * the user can paste the report into a doc / ticket / email without
 * processing it first.
 */
export function smokeTestReportMarkdown(): string {
  const run = getCurrentRun();
  const issues = listIssues();
  const counts = countRun(run);
  const lines: string[] = [];
  lines.push("# Store Ticket Assistant — Real-World Smoke Test report");
  lines.push("");
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  if (run) {
    lines.push(`Run started: ${new Date(run.startedAt).toLocaleString()}`);
    if (run.finishedAt) {
      lines.push(`Run finished: ${new Date(run.finishedAt).toLocaleString()}`);
    }
  }
  lines.push(
    `Result: ${counts.pass} pass / ${counts.fail} fail / ${counts.skipped} skipped / ${counts.pending} pending / ${counts.total} total`,
  );
  lines.push("");

  for (const group of SMOKE_TEST_CHECKLIST) {
    lines.push(`## ${group.title}`);
    lines.push("");
    for (const item of group.items) {
      const rec = run?.records[item.id];
      const status = rec?.status ?? "pending";
      const symbol =
        status === "pass" ? "[x]" : status === "fail" ? "[!]" : status === "skipped" ? "[-]" : "[ ]";
      lines.push(`- ${symbol} ${item.label}${rec?.notes ? ` — ${rec.notes}` : ""}`);
    }
    lines.push("");
  }

  if (issues.length > 0) {
    lines.push(`## Issues (${issues.length})`);
    lines.push("");
    for (const issue of issues) {
      lines.push(
        `### [${issue.severity.toUpperCase()}] ${issue.title} — ${issue.status}`,
      );
      lines.push("");
      if (issue.pageSection) lines.push(`- Page/section: ${issue.pageSection}`);
      if (issue.whatHappened) lines.push(`- What happened: ${issue.whatHappened}`);
      if (issue.expected) lines.push(`- Expected: ${issue.expected}`);
      if (issue.actual) lines.push(`- Actual: ${issue.actual}`);
      if (issue.notes) lines.push(`- Notes: ${issue.notes}`);
      lines.push(`- Created: ${new Date(issue.createdAt).toLocaleString()}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Test reset hook
// ────────────────────────────────────────────────────────────────────────────

export function __resetSmokeTest(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_RUN_KEY);
    localStorage.removeItem(LS_ISSUES_KEY);
  } catch {
    // ignore
  }
}
