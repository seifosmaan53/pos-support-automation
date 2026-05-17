import { useCallback, useMemo, useState } from "react";
import {
  buildIntelligenceReport,
  suggestSolutionsForCurrent,
} from "../services/ticketIntelligence";
import { WarningBox } from "../components/WarningBox";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AddToKnowledgeButton } from "../components/AddToKnowledgeButton";
import { EmptyState } from "../components/EmptyState";
import { useAppStore } from "../services/appStore";
import type {
  IntelligenceReport,
  IssueFrequency,
  RepeatedStoreProblem,
  SimilarSuggestion,
} from "../services/ticketIntelligence";

/**
 * Wrap the inner page in an ErrorBoundary so a thrown exception inside the
 * report builder, the suggestion engine, or any child component cannot blank
 * the app. The boundary's Retry button bumps the inner page's refresh key,
 * forcing a clean rebuild of the report.
 */
export function TicketIntelligencePage() {
  const [retryKey, setRetryKey] = useState(0);
  return (
    <ErrorBoundary
      fallbackTitle="Ticket Intelligence could not load."
      fallbackHint="The rest of the app is still available. Try again, or come back to this view later."
      retryLabel="Retry Analysis"
      onRetry={() => setRetryKey((n) => n + 1)}
    >
      <TicketIntelligenceInner key={retryKey} />
    </ErrorBoundary>
  );
}

interface SafeReport {
  ok: true;
  report: IntelligenceReport;
}

interface FailedReport {
  ok: false;
  error: string;
}

function TicketIntelligenceInner() {
  const [refreshTick, setRefreshTick] = useState(0);
  const transcript = useAppStore((s) => s.transcript);
  const details = useAppStore((s) => s.details);

  const safeReport: SafeReport | FailedReport = useMemo(() => {
    try {
      return { ok: true, report: buildIntelligenceReport() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    // refreshTick is the explicit "retry" signal from the Retry button.
  }, [refreshTick]);

  const suggestions: SimilarSuggestion[] = useMemo(() => {
    const haveDetails = !!(details.category || details.deviceType || details.issue);
    const haveText = !!(details.issue || transcript).trim();
    if (!haveDetails && !haveText) return [];
    try {
      return suggestSolutionsForCurrent({ details, transcript });
    } catch {
      // Suggestion failures should never blank the page — degrade silently.
      return [];
    }
  }, [details, transcript, refreshTick]);

  const onRefresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  if (!safeReport.ok) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader onRefresh={onRefresh} />
        <WarningBox tone="danger">
          <p className="font-medium">Ticket Intelligence could not load.</p>
          <p className="mt-1 text-sm opacity-90">{safeReport.error}</p>
          <button className="btn-secondary mt-3" onClick={onRefresh}>
            Retry Analysis
          </button>
        </WarningBox>
      </div>
    );
  }

  const report = safeReport.report;

  if (report.totalTickets === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader onRefresh={onRefresh} />
        <EmptyState
          icon="chart"
          title="No ticket history yet"
          description="Save 10–20 tickets and this page lights up with common issues, repeated stores, common resolutions, and suggested improvements — all computed locally."
          cta={{ label: "Record your first call", to: "/voice" }}
        />
      </div>
    );
  }

  const hasSeed =
    !!(details.category || details.deviceType || details.issue || transcript);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader onRefresh={onRefresh} />

      {report.isLowData && (
        <WarningBox tone="info">
          <p className="font-medium">Limited ticket history.</p>
          <p className="mt-1 text-sm opacity-90">
            Suggestions may be less accurate until more tickets are saved.
            Patterns become reliable around 10–20 tickets.
          </p>
        </WarningBox>
      )}

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Overview</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total tickets" value={report.totalTickets} />
          <Stat label="Resolved" value={report.resolvedCount} tone="emerald" />
          <Stat label="Pending" value={report.pendingCount} tone="amber" />
          <Stat label="Parts needed" value={report.partsNeededCount} tone="orange" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SuccessRateCard rate={report.resolutionSuccessRate} />
        </div>
        {report.insights.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
            {report.insights.map((i, idx) => (
              <li key={idx}>{i}</li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <FrequencyCard title="Top issue categories" rows={report.topCategories} />
        <FrequencyCard title="Top stores by call count" rows={report.topStores} />
        <FrequencyCard title="Top device issues" rows={report.topDevices} />
        <FrequencyCard
          title="Most common resolution patterns"
          rows={report.topResolutions}
        />
        <FrequencyCard title="Most requested parts" rows={report.partsRequested} />
        <FrequencyCard
          title="Most common missing fields"
          rows={report.missingFieldCounts}
        />
        <RatioCard
          title="Escalation-prone categories"
          rows={report.escalationProneIssues}
          unit="escalations"
        />
        <RatioCard
          title="Replacement-prone categories"
          rows={report.replacementProneIssues}
          unit="part requests"
        />
        <RepeatedStoresCard rows={report.repeatedStoreProblems} />
        <FrequencyCard
          title="AI missed-detail trends"
          rows={report.commonAIMissed}
          emptyHint="No AI-missed feedback recorded yet."
        />
      </div>

      <section className="card space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Suggested Knowledge Base updates</h3>
          <AddToKnowledgeButton
            className="btn-secondary text-xs"
            label="Create Knowledge Item"
          />
        </div>
        {report.knowledgeBaseSuggestions.length === 0 ? (
          <p className="text-xs text-slate-500">
            No KB recommendations yet. They appear once a resolution pattern
            shows up in 3+ tickets, or a category needs replacement parts often.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {report.knowledgeBaseSuggestions.map((s, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="flex-1">• {s}</span>
                <AddToKnowledgeButton
                  className="btn-ghost text-[11px]"
                  label="+ KB"
                  defaultType="troubleshooting_guide"
                />
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-500">
          Knowledge items assist ticket generation but never invent facts that
          aren't in the transcript.
        </p>
      </section>

      {hasSeed && (
        <section className="card space-y-3">
          <h2 className="text-base font-semibold">
            Suggested Solutions Based on Past Tickets
          </h2>
          {suggestions.length === 0 ? (
            <p className="text-xs text-slate-500">
              No similar past tickets found yet. Save a few more tickets and try
              again.
            </p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <SuggestionRow key={i} s={s} />
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-500">
            Suggested based on similar previous tickets only. Verify before
            applying. Not guaranteed to fix the current call.
          </p>
        </section>
      )}
    </div>
  );
}

function PageHeader({ onRefresh }: { onRefresh: () => void }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="page-title">Ticket Intelligence</h1>
        <p className="page-subtitle">
          Local analysis of your saved ticket history. No data leaves this
          machine.
        </p>
      </div>
      <button
        className="btn-secondary"
        onClick={onRefresh}
        title="Re-run the analysis against your latest saved tickets."
      >
        Refresh
      </button>
    </header>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "emerald" | "amber" | "orange";
}) {
  const map: Record<string, string> = {
    slate:
      "border-slate-200 bg-gradient-to-br from-slate-50 to-white text-slate-800 dark:border-slate-700 dark:from-slate-800/60 dark:to-slate-900 dark:text-slate-100",
    emerald:
      "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white text-emerald-800 dark:border-emerald-800/70 dark:from-emerald-950/50 dark:to-slate-900 dark:text-emerald-200",
    amber:
      "border-amber-200 bg-gradient-to-br from-amber-50 to-white text-amber-900 dark:border-amber-800/70 dark:from-amber-950/50 dark:to-slate-900 dark:text-amber-200",
    orange:
      "border-orange-200 bg-gradient-to-br from-orange-50 to-white text-orange-900 dark:border-orange-800/70 dark:from-orange-950/40 dark:to-slate-900 dark:text-orange-200",
  };
  return (
    <div className={`rounded-xl border p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md ${map[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SuccessRateCard({
  rate,
}: {
  rate: { worked: number; didNotWork: number; total: number; rate: number };
}) {
  if (rate.total === 0) {
    return (
      <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-800">
        <div className="text-xs uppercase tracking-wide opacity-70 text-slate-700 dark:text-slate-200">
          Resolution success rate
        </div>
        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          No feedback yet. Mark resolutions Worked / Did Not Work on the
          Ticket Form to populate this.
        </div>
      </div>
    );
  }
  const pct = Math.round(rate.rate * 100);
  return (
    <div className="rounded-md bg-emerald-100 p-3 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
      <div className="text-xs uppercase tracking-wide opacity-70">
        Resolution success rate
      </div>
      <div className="mt-1 text-2xl font-semibold">{pct}%</div>
      <div className="text-xs opacity-80">
        {rate.worked} worked · {rate.didNotWork} did not work · {rate.total} feedback
        rows
      </div>
    </div>
  );
}

function FrequencyCard({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: IssueFrequency[];
  emptyHint?: string;
}) {
  return (
    <section className="card space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyHint ?? "No data yet."}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between">
              <span className="truncate">{r.label}</span>
              <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-medium dark:bg-slate-700">
                {r.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RatioCard({
  title,
  rows,
  unit,
}: {
  title: string;
  rows: IssueFrequency[];
  unit: string;
}) {
  return (
    <section className="card space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          No category has crossed the 2-ticket minimum yet.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between">
              <span className="truncate">{r.label}</span>
              <span className="ml-2 rounded bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                {Math.round((r.ratio ?? 0) * 100)}% · {r.count} {unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RepeatedStoresCard({ rows }: { rows: RepeatedStoreProblem[] }) {
  return (
    <section className="card space-y-2">
      <h3 className="text-sm font-semibold">Repeated store problems</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          No store has called more than once yet.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li
              key={r.store}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">
                Store {r.store}
                {r.topIssue && (
                  <span className="text-xs text-slate-500"> · {r.topIssue}</span>
                )}
              </span>
              <span className="ml-2 rounded bg-sky-200 px-2 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-900/50 dark:text-sky-100">
                {r.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConfidencePill({ c }: { c: SimilarSuggestion["confidence"] }) {
  const tone =
    c === "High"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : c === "Medium"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
        : "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {c} confidence
    </span>
  );
}

function SuggestionRow({ s }: { s: SimilarSuggestion }) {
  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidencePill c={s.confidence} />
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-100">
          {s.basedOnCount} similar ticket{s.basedOnCount === 1 ? "" : "s"}
        </span>
        {s.workedCount > 0 && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            {s.workedCount} worked
          </span>
        )}
        {s.didNotWorkCount > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
            {s.didNotWorkCount} did not work
          </span>
        )}
        {s.escalationRatio >= 0.5 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            ⚠ Often escalated
          </span>
        )}
        {s.partRequestRatio >= 0.5 && (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
            ⚠ Often needs parts
          </span>
        )}
      </div>
      <p className="mt-2 text-slate-700 dark:text-slate-200">{s.suggestion}</p>
      {s.relatedSubjects.length > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          Related: {s.relatedSubjects.slice(0, 3).join(" · ")}
        </div>
      )}
      {s.warning && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">⚠ {s.warning}</p>
      )}
    </li>
  );
}
