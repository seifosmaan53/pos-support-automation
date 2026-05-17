/**
 * Phase 16 — Pilot Mode page.
 *
 * Five panels stacked vertically:
 *   1. Readiness banner — "Ready for daily use" / "Needs attention" with
 *      a short list of fixes if not ready.
 *   2. Event counter grid — period selector (today/week/all) over the 14
 *      pilot event types from the spec.
 *   3. Daily checklist — before / during / after shift items.
 *   4. Pilot Week Report — derived totals + corrections + export button.
 *   5. Tuning Queue — categorized bug list with severity + status.
 *
 * Everything is read from `services/pilotMode`; the page never mutates
 * state directly.
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useConfirm } from "../components/ConfirmDialog";
import { useAppStore } from "../services/appStore";
import {
  addTuningItem,
  DAILY_CHECKLIST,
  FEEDBACK_TAG_LABELS,
  FEEDBACK_TAGS,
  getDailyChecklist,
  getPilotCounts,
  getPilotStartedAt,
  listTicketFeedback,
  listTuningItems,
  PILOT_EVENT_LABELS,
  PILOT_EVENT_TYPES,
  pilotReportMarkdown,
  recordPilotEvent,
  removeTuningItem,
  toggleDailyChecklist,
  TUNING_CATEGORIES,
  TUNING_CATEGORY_LABELS,
  updateTuningItem,
  __resetPilotMode,
  type FeedbackTag,
  type PilotCounts,
  type PilotPeriod,
  type TuningCategory,
  type TuningItem,
  type TuningSeverity,
} from "../services/pilotMode";
import { ticketStore } from "../services/databaseService";
import { audioFilesStore } from "../services/audioFilesStore";
import { countOpenCriticalIssues } from "../services/smokeTest";
import { getLastBackupAt } from "../services/backupService";
import { isTauriDesktop, writeTextFile } from "../services/systemStorage";
import { logError } from "../services/errorLog";

type Tone = "ok" | "warning" | "error" | "info" | "neutral";

function dot(tone: Tone) {
  const map: Record<Tone, string> = {
    ok: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-red-500",
    info: "bg-sky-500",
    neutral: "bg-slate-400",
  };
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${map[tone]}`} />;
}

export function PilotPage() {
  const settings = useAppStore((s) => s.settings);
  const setStatus = useAppStore((s) => s.setStatus);
  const confirm = useConfirm();
  // `tick` is a manual re-render trigger: every mutation calls `bump()` which
  // increments it, which invalidates the useMemos below that depend on it.
  // It's a load-bearing dep — referenced in every useMemo's dependency array.
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const [period, setPeriod] = useState<PilotPeriod>("week");
  const counts = useMemo<PilotCounts>(() => getPilotCounts(period), [period, tick]);
  const checklist = useMemo(() => getDailyChecklist(), [tick]);
  const tuning = useMemo(() => listTuningItems(), [tick]);
  const tagFeedback = useMemo(() => listTicketFeedback(), [tick]);
  const startedAt = useMemo(() => getPilotStartedAt(), [tick]);
  const lastBackup = useMemo(() => getLastBackupAt(), [tick]);

  // Readiness derivation — see Phase 16 §5.
  const readiness = useMemo(() => {
    const openCritical = countOpenCriticalIssues();
    const tickets = ticketStore.list();
    const audioRows = audioFilesStore.list().filter((a) => !a.deleted);
    const allCounts = getPilotCounts("all");
    const attachAttempts =
      allCounts.recordingAttached + allCounts.ticketSavedWithoutAudio;
    const attachRate =
      attachAttempts > 0 ? allCounts.recordingAttached / attachAttempts : 1;
    const tuningCritical = tuning.filter(
      (t) => t.status === "open" && (t.severity === "critical" || t.severity === "high"),
    ).length;

    const fixes: string[] = [];
    if (openCritical > 0) fixes.push(`Resolve ${openCritical} critical/high smoke-test issue(s).`);
    if (tuningCritical > 0)
      fixes.push(`Resolve ${tuningCritical} critical/high tuning queue item(s).`);
    if (!lastBackup) fixes.push("Export a backup before relying on the app daily.");
    if (audioRows.length > 0 && attachRate < 0.8 && attachAttempts >= 5)
      fixes.push(
        `Audio attach success rate is ${(attachRate * 100).toFixed(0)}% — investigate the audio attachment flow.`,
      );
    if (tickets.length === 0)
      fixes.push("Save at least one real ticket before deciding the app is daily-use-ready.");

    return {
      ready: fixes.length === 0,
      fixes,
      tickets: tickets.length,
      recordings: allCounts.recordingSaved,
      attachRate,
      openCritical,
      tuningCritical,
    };
  }, [tuning, lastBackup]);

  const totalsForReport = useMemo(() => {
    const allCounts = getPilotCounts("all");
    const attachAttempts = allCounts.recordingAttached + allCounts.ticketSavedWithoutAudio;
    const attachRate =
      attachAttempts > 0 ? allCounts.recordingAttached / attachAttempts : 1;
    // Tag rollup → "most common feedback tags".
    const tagCounts = new Map<FeedbackTag, number>();
    for (const fb of tagFeedback) {
      for (const t of fb.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    const mostCommonIssueTypes = [...tagCounts.entries()]
      .map(([tag, count]) => ({ label: FEEDBACK_TAG_LABELS[tag], count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    // Store rollup.
    const storeCounts = new Map<string, number>();
    for (const t of ticketStore.list()) {
      const s = t.details?.storeNumber?.trim() ?? "";
      if (!s) continue;
      storeCounts.set(s, (storeCounts.get(s) ?? 0) + 1);
    }
    const mostCommonStores = [...storeCounts.entries()]
      .map(([storeNumber, count]) => ({ storeNumber, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    // Tuning-category rollup → "most common corrections".
    const cat = new Map<TuningCategory, number>();
    for (const item of tuning) {
      cat.set(item.category, (cat.get(item.category) ?? 0) + 1);
    }
    const mostCommonCorrections = [...cat.entries()]
      .map(([c, count]) => ({ label: TUNING_CATEGORY_LABELS[c], count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return {
      totalTickets: ticketStore.list().length,
      totalRecordings: allCounts.recordingSaved,
      audioAttachSuccessRate: attachRate,
      mostCommonIssueTypes,
      mostCommonStores,
      mostCommonCorrections,
      callerNameCorrections: allCounts.callerNameCorrection,
      speakerCorrections: allCounts.speakerCorrection,
      transcriptCorrections: allCounts.manualCorrection,
      ticketsNeedingRework: tagCounts.get("needsCorrection") ?? 0,
      openCriticalIssues: readiness.openCritical + readiness.tuningCritical,
      recommendedFixes: readiness.fixes,
    };
  }, [tagFeedback, tuning, readiness]);

  const exportReport = useCallback(async () => {
    const md = pilotReportMarkdown(totalsForReport);
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const filename = `sta-pilot-report-${stamp}.md`;
    try {
      if (isTauriDesktop()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const dest = await save({ defaultPath: filename });
        if (!dest) return;
        await writeTextFile(dest, md, true);
        setStatus({ kind: "success", message: `Pilot report written to ${dest}` });
      } else {
        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        setStatus({ kind: "success", message: "Pilot report downloaded." });
      }
    } catch (e) {
      const msg = (e as Error).message;
      logError({ source: "ui", op: "pilot-report-export", message: msg });
      setStatus({ kind: "error", message: `Export failed: ${msg}` });
    }
  }, [setStatus, totalsForReport]);

  const handleResetPilot = useCallback(async () => {
    const ok = await confirm({
      title: "Reset pilot data?",
      message:
        "All pilot counters, daily checklist state, ticket feedback tags, and tuning-queue items will be erased from this machine. Saved tickets, audio, and the smoke test page are untouched.",
      confirmLabel: "Reset pilot",
      destructive: true,
    });
    if (!ok) return;
    __resetPilotMode();
    bump();
  }, [bump, confirm]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 className="page-title">Pilot Mode</h1>
        <p className="page-subtitle">
          Track real-world use across a pilot week. Counters update as you
          save tickets, attach audio, use Copy Mode, and capture feedback.
        </p>
      </header>

      <ReadinessBanner readiness={readiness} />

      <CountersPanel
        counts={counts}
        period={period}
        onPeriod={setPeriod}
        startedAt={startedAt}
      />

      <DailyChecklistPanel
        checks={checklist.checks}
        onToggle={(id) => {
          toggleDailyChecklist(id);
          bump();
        }}
      />

      <PilotReportPanel
        totals={totalsForReport}
        onExport={() => void exportReport()}
      />

      <TuningQueuePanel
        items={tuning}
        settings={settings}
        onAdd={(input) => {
          addTuningItem(input);
          bump();
        }}
        onUpdate={(id, patch) => {
          updateTuningItem(id, patch);
          bump();
        }}
        onRemove={(id) => {
          removeTuningItem(id);
          bump();
        }}
      />

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Other entry points</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/" className="btn-ghost text-xs">Home</Link>
          <Link to="/voice" className="btn-ghost text-xs">New Ticket</Link>
          <Link to="/history" className="btn-ghost text-xs">History</Link>
          <Link to="/smoke-test" className="btn-ghost text-xs">Smoke Test</Link>
          <Link to="/system" className="btn-ghost text-xs">System Health</Link>
          <button
            type="button"
            className="btn-ghost text-xs text-red-600 dark:text-red-400"
            onClick={() => void handleResetPilot()}
          >
            Reset pilot data
          </button>
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Pilot tip: every time you save a ticket, scroll down on the Ticket
        Form Helper to add a quick feedback tag. The Pilot Week Report rolls
        those tags into recommended fixes.
      </p>
    </div>
  );
}

function ReadinessBanner({
  readiness,
}: {
  readiness: {
    ready: boolean;
    fixes: string[];
    tickets: number;
    recordings: number;
    attachRate: number;
  };
}) {
  return (
    <section
      className={`rounded-md border px-3 py-3 text-sm ${
        readiness.ready
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
      }`}
    >
      <div className="flex items-center gap-2">
        {dot(readiness.ready ? "ok" : "warning")}
        <h2 className="text-base font-semibold">
          {readiness.ready ? "Ready for daily use" : "Needs attention"}
        </h2>
        <span className="ml-auto text-xs text-slate-600 dark:text-slate-400">
          {readiness.tickets} ticket(s) · {readiness.recordings} recording(s) ·
          {" "}
          {(readiness.attachRate * 100).toFixed(0)}% audio attach rate
        </span>
      </div>
      {!readiness.ready && readiness.fixes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-700 dark:text-slate-300">
          {readiness.fixes.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CountersPanel({
  counts,
  period,
  onPeriod,
  startedAt,
}: {
  counts: PilotCounts;
  period: PilotPeriod;
  onPeriod: (p: PilotPeriod) => void;
  startedAt: string | null;
}) {
  const periods: { value: PilotPeriod; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "week", label: "This week" },
    { value: "all", label: "All pilot data" },
  ];
  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Event counters</h2>
          <p className="text-xs text-slate-500">
            {startedAt
              ? `Pilot started: ${new Date(startedAt).toLocaleDateString()}`
              : "Pilot starts the moment your first event fires."}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {periods.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                period === p.value
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-600 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-900/40"
              }`}
              onClick={() => onPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-3">
        {PILOT_EVENT_TYPES.map((t) => (
          <div key={t} className="flex items-center justify-between gap-2">
            <dt className="text-xs text-slate-500">{PILOT_EVENT_LABELS[t]}</dt>
            <dd className="font-mono">{counts[t]}</dd>
          </div>
        ))}
      </dl>
      <div className="text-xs text-slate-500">
        <span className="font-semibold">Tracked tags:</span>{" "}
        {FEEDBACK_TAGS.map((t) => FEEDBACK_TAG_LABELS[t]).join(" · ")}
      </div>
    </section>
  );
}

function DailyChecklistPanel({
  checks,
  onToggle,
}: {
  checks: Record<string, string>;
  onToggle: (id: string) => void;
}) {
  const stages: { stage: "before" | "during" | "after"; title: string }[] = [
    { stage: "before", title: "Before shift" },
    { stage: "during", title: "During shift" },
    { stage: "after", title: "After shift" },
  ];
  return (
    <section className="card space-y-2">
      <h2 className="text-base font-semibold">Daily pilot checklist</h2>
      <p className="text-xs text-slate-500">
        Resets each day. Toggle each item as you complete it during the
        shift.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {stages.map((s) => (
          <div key={s.stage} className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {s.title}
            </div>
            <ul className="space-y-1">
              {DAILY_CHECKLIST.filter((c) => c.stage === s.stage).map((c) => (
                <li key={c.id} className="text-xs">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={!!checks[c.id]}
                      onChange={() => onToggle(c.id)}
                    />
                    <span>{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function PilotReportPanel({
  totals,
  onExport,
}: {
  totals: ReturnType<typeof pilotReportMarkdown> extends string
    ? Parameters<typeof pilotReportMarkdown>[0]
    : never;
  onExport: () => void;
}) {
  return (
    <section className="card space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Pilot Week Report</h2>
        <button className="btn-primary text-xs" onClick={onExport}>
          Export Pilot Report
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-3">
        <Stat label="Total tickets" value={totals.totalTickets} />
        <Stat label="Total recordings" value={totals.totalRecordings} />
        <Stat
          label="Audio attach success"
          value={`${(totals.audioAttachSuccessRate * 100).toFixed(1)}%`}
        />
        <Stat label="Tickets needing rework" value={totals.ticketsNeedingRework} />
        <Stat label="Caller name corrections" value={totals.callerNameCorrections} />
        <Stat label="Speaker corrections" value={totals.speakerCorrections} />
        <Stat label="Transcript corrections" value={totals.transcriptCorrections} />
        <Stat label="Open critical issues" value={totals.openCriticalIssues} />
      </dl>
      {totals.mostCommonIssueTypes.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            Most common feedback tags
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {totals.mostCommonIssueTypes.map((r) => (
              <li key={r.label}>
                {r.label} — {r.count}
              </li>
            ))}
          </ul>
        </details>
      )}
      {totals.mostCommonStores.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            Most common stores
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {totals.mostCommonStores.map((r) => (
              <li key={r.storeNumber}>
                Store {r.storeNumber} — {r.count} ticket(s)
              </li>
            ))}
          </ul>
        </details>
      )}
      {totals.recommendedFixes.length > 0 && (
        <details open className="text-xs">
          <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-300">
            Recommended fixes before full daily use
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {totals.recommendedFixes.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function TuningQueuePanel({
  items,
  settings,
  onAdd,
  onUpdate,
  onRemove,
}: {
  items: TuningItem[];
  settings: ReturnType<typeof useAppStore.getState>["settings"];
  onAdd: (input: {
    title: string;
    category: TuningCategory;
    severity?: TuningSeverity;
    notes?: string;
  }) => void;
  onUpdate: (id: string, patch: Partial<TuningItem>) => void;
  onRemove: (id: string) => void;
}) {
  void settings;
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TuningCategory>("transcription");
  const [severity, setSeverity] = useState<TuningSeverity>("medium");
  const [notes, setNotes] = useState("");
  const submit = () => {
    if (!title.trim()) return;
    onAdd({ title, category, severity, notes });
    setTitle("");
    setNotes("");
  };

  const grouped = useMemo(() => {
    const open = items.filter((i) => i.status === "open");
    const fixed = items.filter((i) => i.status === "fixed");
    const ignored = items.filter((i) => i.status === "ignored");
    return { open, fixed, ignored };
  }, [items]);

  return (
    <section className="card space-y-2 text-sm">
      <h2 className="text-base font-semibold">
        Tuning queue ({items.length})
      </h2>
      <p className="text-xs text-slate-500">
        Bottom-up observations from real calls. Different from Smoke Test
        issues — those are checklist-driven; these are field-driven.
      </p>
      <div className="space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
        <input
          type="text"
          className="w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
          placeholder="Tuning item title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-500">Category:</label>
          <select
            className="rounded border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
            value={category}
            onChange={(e) => setCategory(e.target.value as TuningCategory)}
          >
            {TUNING_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TUNING_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <label className="text-xs text-slate-500">Severity:</label>
          <select
            className="rounded border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as TuningSeverity)}
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button className="btn-primary text-xs" onClick={submit} disabled={!title.trim()}>
            Add tuning item
          </button>
        </div>
        <textarea
          className="w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
          placeholder="Notes (optional — what was observed, expected vs actual, etc.)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
      </div>

      <QueueList title="Open" items={grouped.open} onUpdate={onUpdate} onRemove={onRemove} />
      {grouped.fixed.length > 0 && (
        <QueueList title="Fixed" items={grouped.fixed} onUpdate={onUpdate} onRemove={onRemove} />
      )}
      {grouped.ignored.length > 0 && (
        <QueueList title="Ignored" items={grouped.ignored} onUpdate={onUpdate} onRemove={onRemove} />
      )}
    </section>
  );
}

function QueueList({
  title,
  items,
  onUpdate,
  onRemove,
}: {
  title: string;
  items: TuningItem[];
  onUpdate: (id: string, patch: Partial<TuningItem>) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title} (0)
        </div>
        <p className="text-xs text-slate-500">No items.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} ({items.length})
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-md border border-slate-200 p-2 text-xs dark:border-slate-700"
          >
            <div className="flex flex-wrap items-start justify-between gap-1">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityChip s={item.severity} />
                  <span className="font-medium">{item.title}</span>
                  <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] dark:bg-slate-800">
                    {TUNING_CATEGORY_LABELS[item.category]}
                  </span>
                </div>
                {item.notes && (
                  <div className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                    {item.notes}
                  </div>
                )}
              </div>
              <div className="flex flex-none gap-1">
                {item.status !== "fixed" && (
                  <button
                    className="btn-ghost text-[11px]"
                    onClick={() => onUpdate(item.id, { status: "fixed" })}
                  >
                    Mark fixed
                  </button>
                )}
                {item.status !== "ignored" && (
                  <button
                    className="btn-ghost text-[11px]"
                    onClick={() => onUpdate(item.id, { status: "ignored" })}
                  >
                    Ignore
                  </button>
                )}
                {item.status !== "open" && (
                  <button
                    className="btn-ghost text-[11px]"
                    onClick={() => onUpdate(item.id, { status: "open" })}
                  >
                    Re-open
                  </button>
                )}
                <button
                  className="btn-ghost text-[11px] text-red-600 dark:text-red-400"
                  onClick={() => onRemove(item.id)}
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

function SeverityChip({ s }: { s: TuningSeverity }) {
  const map: Record<TuningSeverity, string> = {
    critical: "bg-red-600 text-white",
    high: "bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-200",
    medium: "bg-amber-200 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
    low: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  return (
    <span
      className={`inline-block rounded px-1 py-0.5 text-[9px] uppercase tracking-wide ${map[s]}`}
    >
      {s}
    </span>
  );
}

// Convenience export so the appStore wiring can reference the recordPilotEvent
// indirectly via this module without an additional import.
export { recordPilotEvent } from "../services/pilotMode";
