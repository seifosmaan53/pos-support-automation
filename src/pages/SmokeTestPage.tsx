/**
 * Phase 14 — Real-World Smoke Test page.
 *
 * Three panels:
 *   1. Checklist — grouped Pass/Fail/Skip/Notes for every spec item.
 *   2. Preset transcripts — five canonical calls. Load one into the
 *      transcript editor and watch the rest of the workflow handle it.
 *   3. Issues — captures the bug-report dialog from any Fail click.
 *
 * Designed so the user can run a smoke test across a shift without losing
 * progress; everything persists to localStorage via `services/smokeTest`.
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { useConfirm } from "../components/ConfirmDialog";
import {
  addIssue,
  ALL_SMOKE_TEST_ITEM_IDS,
  clearSmokeTest,
  countRun,
  countOpenCriticalIssues,
  finishSmokeTest,
  getCurrentRun,
  listIssues,
  removeIssue,
  setItemNotes,
  setItemStatus,
  smokeTestReportMarkdown,
  SMOKE_TEST_CHECKLIST,
  startNewSmokeTest,
  updateIssue,
  type IssueSeverity,
  type SmokeTestItem,
  type SmokeTestIssue,
  type SmokeTestRun,
  type SmokeTestStatus,
} from "../services/smokeTest";
import {
  SMOKE_TEST_TRANSCRIPTS,
  type SmokeTestTranscript,
} from "../data/smokeTestTranscripts";
import { isTauriDesktop, writeTextFile } from "../services/systemStorage";
import { logError } from "../services/errorLog";
import { markRcSignal } from "../services/releaseChecklist";

type Tone = "ok" | "warning" | "error" | "info" | "neutral";

const STATUS_TONES: Record<SmokeTestStatus, Tone> = {
  pending: "neutral",
  pass: "ok",
  fail: "error",
  skipped: "warning",
};

function dot(tone: Tone) {
  const map: Record<Tone, string> = {
    ok: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-red-500",
    info: "bg-sky-500",
    neutral: "bg-slate-400",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${map[tone]}`} />;
}

export function SmokeTestPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const setTranscript = useAppStore((s) => s.setTranscript);
  const setStatus = useAppStore((s) => s.setStatus);

  // Tick on every mutation so the panel re-reads from localStorage.
  // setTick triggering a re-render is the only effect we need here; the
  // function body below re-reads getCurrentRun() / listIssues() on each
  // render, so we don't need to thread `tick` into a useMemo dep list.
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const run = getCurrentRun();
  const issues = listIssues();
  const counts = countRun(run);
  const openCritical = countOpenCriticalIssues();

  const [issueForItem, setIssueForItem] = useState<SmokeTestItem | null>(null);

  const handleSetStatus = useCallback(
    (item: SmokeTestItem, status: SmokeTestStatus) => {
      setItemStatus(item.id, status);
      bump();
      if (status === "fail") {
        // Open the bug-capture dialog so the failure has context.
        setIssueForItem(item);
      }
    },
    [bump],
  );

  const handleSetNotes = useCallback(
    (id: string, notes: string) => {
      setItemNotes(id, notes);
      bump();
    },
    [bump],
  );

  const startFresh = useCallback(async () => {
    if (run && Object.keys(run.records).length > 0) {
      const ok = await confirm({
        title: "Start a new smoke test?",
        message:
          "The current run will be erased. Issues you have already filed will be preserved.",
        confirmLabel: "Start new",
        destructive: true,
      });
      if (!ok) return;
    }
    startNewSmokeTest();
    bump();
  }, [bump, confirm, run]);

  const save = useCallback(() => {
    finishSmokeTest();
    bump();
    setStatus({ kind: "success", message: "Smoke test saved (finishedAt stamped)." });
  }, [bump, setStatus]);

  const clearRun = useCallback(async () => {
    const ok = await confirm({
      title: "Clear current smoke test?",
      message:
        "Removes the in-progress run from this machine. Existing issue tickets are kept.",
      confirmLabel: "Clear",
      destructive: true,
    });
    if (!ok) return;
    clearSmokeTest();
    bump();
  }, [bump, confirm]);

  const exportReport = useCallback(async () => {
    const md = smokeTestReportMarkdown();
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const filename = `sta-smoke-test-${stamp}.md`;
    try {
      if (isTauriDesktop()) {
        const { save: pickPath } = await import("@tauri-apps/plugin-dialog");
        const dest = await pickPath({ defaultPath: filename });
        if (!dest) return;
        await writeTextFile(dest, md, true);
        markRcSignal("lastSmokeTestExportAt");
        setStatus({ kind: "success", message: `Report written to ${dest}` });
      } else {
        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        markRcSignal("lastSmokeTestExportAt");
        setStatus({ kind: "success", message: "Report downloaded." });
      }
    } catch (e) {
      const msg = (e as Error).message;
      logError({ source: "ui", op: "smoke-test-report-export", message: msg });
      setStatus({ kind: "error", message: `Export failed: ${msg}` });
    }
  }, [setStatus]);

  const loadPresetTranscript = useCallback(
    (t: SmokeTestTranscript) => {
      setTranscript(t.transcript);
      setStatus({
        kind: "info",
        message: `Loaded preset ${t.id} (${t.title}). Open Transcript Review or run Analyze.`,
      });
      navigate("/transcript");
    },
    [navigate, setStatus, setTranscript],
  );

  const onIssueSubmit = useCallback(
    (issue: Omit<SmokeTestIssue, "id" | "createdAt" | "updatedAt" | "status">) => {
      addIssue({ ...issue, runId: run?.id });
      bump();
      setIssueForItem(null);
    },
    [bump, run?.id],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 className="page-title">Real-World Smoke Test</h1>
        <p className="page-subtitle">
          Walk through the app like a real shift. Mark each item Pass / Fail
          / Skip; failures open the issue form so the bug has context.
        </p>
      </header>

      <CountsBanner counts={counts} openCritical={openCritical} />

      <ActionsRow
        onStartNew={() => void startFresh()}
        onSave={save}
        onExport={() => void exportReport()}
        onClear={() => void clearRun()}
        hasRun={!!run}
      />

      {SMOKE_TEST_CHECKLIST.map((group) => (
        <section key={group.id} className="card space-y-2">
          <h2 className="text-base font-semibold">{group.title}</h2>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {group.items.map((item) => {
              const rec = run?.records[item.id];
              const status: SmokeTestStatus = rec?.status ?? "pending";
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <span className="mt-1">{dot(STATUS_TONES[status])}</span>
                    <div className="min-w-0">
                      <div className="font-medium">{item.label}</div>
                      <input
                        type="text"
                        className="mt-1 w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 dark:border-slate-700 dark:text-slate-300"
                        placeholder="Notes (optional)"
                        defaultValue={rec?.notes ?? ""}
                        onBlur={(e) => handleSetNotes(item.id, e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-none gap-1">
                    <StatusButton
                      current={status}
                      target="pass"
                      label="Pass"
                      onClick={() => handleSetStatus(item, "pass")}
                    />
                    <StatusButton
                      current={status}
                      target="fail"
                      label="Fail"
                      onClick={() => handleSetStatus(item, "fail")}
                    />
                    <StatusButton
                      current={status}
                      target="skipped"
                      label="Skip"
                      onClick={() => handleSetStatus(item, "skipped")}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <PresetTranscriptsPanel
        onLoad={loadPresetTranscript}
        onAnalyzeAndOpen={(t) => {
          setTranscript(t.transcript);
          navigate("/transcript");
        }}
      />

      <WritingSpotCheckPanel />

      <IssuesPanel
        issues={issues}
        onUpdate={(id, patch) => {
          updateIssue(id, patch);
          bump();
        }}
        onRemove={(id) => {
          removeIssue(id);
          bump();
        }}
      />

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Where to go next</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/" className="btn-ghost text-xs">
            Home
          </Link>
          <Link to="/voice" className="btn-ghost text-xs">
            New Ticket
          </Link>
          <Link to="/system" className="btn-ghost text-xs">
            System Health
          </Link>
          <Link to="/history" className="btn-ghost text-xs">
            History
          </Link>
        </div>
      </section>

      {issueForItem && (
        <IssueDialog
          item={issueForItem}
          onClose={() => setIssueForItem(null)}
          onSubmit={onIssueSubmit}
        />
      )}
    </div>
  );
}

function CountsBanner({
  counts,
  openCritical,
}: {
  counts: ReturnType<typeof countRun>;
  openCritical: number;
}) {
  const ready = counts.fail === 0 && counts.pending === 0 && openCritical === 0;
  const tone: Tone = ready ? "ok" : counts.fail > 0 || openCritical > 0 ? "warning" : "info";
  return (
    <section
      className={`rounded-md border px-3 py-2 text-sm ${
        tone === "ok"
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : tone === "warning"
            ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
            : "border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">
          {ready
            ? "Smoke test complete — every item passed."
            : counts.pending > 0
              ? `Smoke test in progress: ${counts.pass} pass, ${counts.fail} fail, ${counts.skipped} skipped, ${counts.pending} pending.`
              : `Smoke test done: ${counts.pass} pass, ${counts.fail} fail, ${counts.skipped} skipped.`}
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-400">
          Open critical/high issues: <strong>{openCritical}</strong>
        </div>
      </div>
    </section>
  );
}

function ActionsRow({
  onStartNew,
  onSave,
  onExport,
  onClear,
  hasRun,
}: {
  onStartNew: () => void;
  onSave: () => void;
  onExport: () => void;
  onClear: () => void;
  hasRun: boolean;
}) {
  return (
    <section className="card space-y-2">
      <h2 className="text-base font-semibold">Actions</h2>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary text-xs" onClick={onStartNew}>
          Start New Smoke Test
        </button>
        <button className="btn-ghost text-xs" onClick={onSave} disabled={!hasRun}>
          Save Smoke Test Result
        </button>
        <button className="btn-ghost text-xs" onClick={onExport}>
          Export Smoke Test Report
        </button>
        <button className="btn-ghost text-xs" onClick={onClear} disabled={!hasRun}>
          Clear Smoke Test
        </button>
      </div>
    </section>
  );
}

function StatusButton({
  current,
  target,
  label,
  onClick,
}: {
  current: SmokeTestStatus;
  target: SmokeTestStatus;
  label: string;
  onClick: () => void;
}) {
  const active = current === target;
  const base =
    "rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50";
  const tone =
    target === "pass"
      ? active
        ? "border-emerald-500 bg-emerald-500 text-white"
        : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
      : target === "fail"
        ? active
          ? "border-red-500 bg-red-500 text-white"
          : "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/30"
        : active
          ? "border-amber-500 bg-amber-500 text-white"
          : "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/30";
  return (
    <button type="button" className={`${base} ${tone}`} onClick={onClick}>
      {label}
    </button>
  );
}

function PresetTranscriptsPanel({
  onLoad,
  onAnalyzeAndOpen,
}: {
  onLoad: (t: SmokeTestTranscript) => void;
  onAnalyzeAndOpen: (t: SmokeTestTranscript) => void;
}) {
  return (
    <section className="card space-y-2">
      <div>
        <h2 className="text-base font-semibold">Preset smoke-test transcripts</h2>
        <p className="text-xs text-slate-500">
          Load one to exercise extraction, speaker labels, writing, result
          detection, part-request logic, copy mode, and save/history.
        </p>
      </div>
      <ul className="space-y-2">
        {SMOKE_TEST_TRANSCRIPTS.map((t) => (
          <li
            key={t.id}
            className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{t.title}</div>
                <div className="mt-0.5 text-xs text-slate-500">{t.description}</div>
              </div>
              <div className="flex gap-1">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => onLoad(t)}
                  title="Load this transcript and open Transcript Review"
                >
                  Load
                </button>
                <button
                  className="btn-primary text-xs"
                  onClick={() => onAnalyzeAndOpen(t)}
                >
                  Load &amp; review
                </button>
              </div>
            </div>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-slate-500">
                What this should detect ({t.expects.length} items)
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {t.expects.map((e, i) => (
                  <li key={i} className="font-mono">
                    {e}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WritingSpotCheckPanel() {
  return (
    <section className="card space-y-2 text-sm">
      <h2 className="text-base font-semibold">Writing quality spot check</h2>
      <p className="text-xs text-slate-500">
        After generating a ticket, run through the checklist below on the
        Generated Note / Ticket Form Helper / History inspect view. Mark
        the Final group items above based on what you see.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700 dark:text-slate-300">
        <li>Sounds natural — no robotic phrasing or dialogue snippets.</li>
        <li>No dialogue ("I said…", "the caller said…") in the description.</li>
        <li>No fake facts — every claim is supported by the transcript.</li>
        <li>Description and Resolution are separate sections.</li>
        <li>
          Result is not marked Resolved unless the transcript explicitly
          confirms it.
        </li>
        <li>
          No part request unless the transcript explicitly calls for one.
        </li>
        <li>
          Store / Register / Device are included when the transcript names
          them.
        </li>
        <li>
          Short / Normal / Detailed / Technical / Management summaries are
          all readable on their own.
        </li>
      </ul>
      <div className="text-xs">
        <Link to="/ticket" className="btn-ghost text-xs">
          Open Generated Note
        </Link>
        <Link to="/form" className="btn-ghost ml-1 text-xs">
          Open Ticket Form Helper
        </Link>
      </div>
    </section>
  );
}

function IssuesPanel({
  issues,
  onUpdate,
  onRemove,
}: {
  issues: SmokeTestIssue[];
  onUpdate: (id: string, patch: Partial<SmokeTestIssue>) => void;
  onRemove: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const open = issues.filter((i) => i.status === "open");
    const fixed = issues.filter((i) => i.status === "fixed");
    const other = issues.filter((i) => i.status !== "open" && i.status !== "fixed");
    return { open, fixed, other };
  }, [issues]);
  return (
    <section className="card space-y-2 text-sm">
      <h2 className="text-base font-semibold">
        Smoke Test Issues ({issues.length})
      </h2>
      {issues.length === 0 && (
        <p className="text-xs text-slate-500">
          No issues filed. Click Fail on any checklist item to capture one.
        </p>
      )}
      <IssueList
        title="Open"
        list={grouped.open}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
      {grouped.fixed.length > 0 && (
        <IssueList
          title="Fixed"
          list={grouped.fixed}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      )}
      {grouped.other.length > 0 && (
        <IssueList
          title="Other"
          list={grouped.other}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      )}
    </section>
  );
}

function IssueList({
  title,
  list,
  onUpdate,
  onRemove,
}: {
  title: string;
  list: SmokeTestIssue[];
  onUpdate: (id: string, patch: Partial<SmokeTestIssue>) => void;
  onRemove: (id: string) => void;
}) {
  if (list.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} ({list.length})
      </div>
      <ul className="space-y-1.5">
        {list.map((issue) => (
          <li
            key={issue.id}
            className="rounded-md border border-slate-200 p-2 text-xs dark:border-slate-700"
          >
            <div className="flex flex-wrap items-start justify-between gap-1">
              <div className="min-w-0">
                <div className="font-medium">
                  <SeverityChip s={issue.severity} /> {issue.title}
                </div>
                {issue.pageSection && (
                  <div className="text-[11px] text-slate-500">
                    Page: {issue.pageSection}
                  </div>
                )}
                {issue.whatHappened && (
                  <div className="mt-1 whitespace-pre-wrap">
                    <strong>What:</strong> {issue.whatHappened}
                  </div>
                )}
                {issue.expected && (
                  <div className="whitespace-pre-wrap">
                    <strong>Expected:</strong> {issue.expected}
                  </div>
                )}
                {issue.actual && (
                  <div className="whitespace-pre-wrap">
                    <strong>Actual:</strong> {issue.actual}
                  </div>
                )}
                {issue.notes && (
                  <div className="whitespace-pre-wrap">
                    <strong>Notes:</strong> {issue.notes}
                  </div>
                )}
              </div>
              <div className="flex flex-none gap-1">
                {issue.status !== "fixed" && (
                  <button
                    className="btn-ghost text-[11px]"
                    onClick={() => onUpdate(issue.id, { status: "fixed" })}
                  >
                    Mark fixed
                  </button>
                )}
                {issue.status === "fixed" && (
                  <button
                    className="btn-ghost text-[11px]"
                    onClick={() => onUpdate(issue.id, { status: "open" })}
                  >
                    Re-open
                  </button>
                )}
                <button
                  className="btn-ghost text-[11px] text-red-600 dark:text-red-400"
                  onClick={() => onRemove(issue.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeverityChip({ s }: { s: IssueSeverity }) {
  const map: Record<IssueSeverity, string> = {
    critical: "bg-red-600 text-white",
    high: "bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-200",
    medium: "bg-amber-200 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
    low: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  return (
    <span
      className={`mr-1 inline-block rounded px-1 py-0.5 text-[9px] uppercase tracking-wide ${map[s]}`}
    >
      {s}
    </span>
  );
}

function IssueDialog({
  item,
  onClose,
  onSubmit,
}: {
  item: SmokeTestItem;
  onClose: () => void;
  onSubmit: (
    issue: Omit<SmokeTestIssue, "id" | "createdAt" | "updatedAt" | "status">,
  ) => void;
}) {
  const [title, setTitle] = useState("");
  const [whatHappened, setWhatHappened] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [pageSection, setPageSection] = useState("");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [notes, setNotes] = useState("");
  const submit = () => {
    onSubmit({
      title: title || item.label,
      whatHappened,
      expected,
      actual,
      pageSection,
      severity,
      notes,
      itemId: item.id,
    });
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-semibold">Capture a bug</h3>
          <p className="text-xs text-slate-500">
            Failure on: <strong>{item.label}</strong>
          </p>
        </div>
        <input
          type="text"
          className="w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
          placeholder={item.label}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          type="text"
          className="w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
          placeholder="Page/section (e.g. Voice Ticket / Copy Mode)"
          value={pageSection}
          onChange={(e) => setPageSection(e.target.value)}
        />
        <textarea
          className="w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
          placeholder="What happened?"
          value={whatHappened}
          onChange={(e) => setWhatHappened(e.target.value)}
          rows={2}
        />
        <textarea
          className="w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
          placeholder="Expected behavior"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          rows={2}
        />
        <textarea
          className="w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
          placeholder="Actual behavior"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          rows={2}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Severity:</label>
          <select
            className="rounded border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <textarea
          className="w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
          placeholder="Screenshot reference / extra notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit}>
            Capture issue
          </button>
        </div>
      </div>
    </div>
  );
}

// `ALL_SMOKE_TEST_ITEM_IDS` is exported only so the smokeTest test suite can
// flatten; the page itself uses SMOKE_TEST_CHECKLIST directly.
export const _smokeTestItemIds = ALL_SMOKE_TEST_ITEM_IDS;
