import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ticketStore, getStorageBackend } from "../services/databaseService";
import { useAppStore } from "../services/appStore";
import { formatDateTime } from "../utils/formatDate";
import { WarningBox } from "../components/WarningBox";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { TicketBadges } from "../components/TicketBadges";
import { TicketInspectView } from "../components/TicketInspectView";
import { OrphanRecordingsPanel } from "../components/OrphanRecordingsPanel";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRow } from "../components/Skeleton";
import { Icon } from "../components/Icon";
import {
  DEFAULT_FILTERS,
  isAnyFilterActive,
  ticketMatchesFilters,
  type HistoryFilters,
  type TriState,
} from "../utils/ticketFilters";
import { matchesQuery, ticketHaystack } from "../utils/ticketSearch";
import type { SavedTicket } from "../types/ticket";
import { TICKET_RESULTS } from "../types/ticket";

export function HistoryPage() {
  return (
    <ErrorBoundary
      fallbackTitle="History could not load."
      fallbackHint="The rest of the app is still available. Try clicking Retry, or open another page and come back."
      retryLabel="Retry"
    >
      <HistoryPageInner />
    </ErrorBoundary>
  );
}

function HistoryPageInner() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [refreshTick, setRefresh] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setStatus = useAppStore((s) => s.setStatus);
  const askConfirm = useConfirm();
  const loadTicket = useAppStore((s) => s.loadTicket);
  const reanalyzeFromSavedSpeaker = useAppStore(
    (s) => s.reanalyzeFromSavedSpeakerTranscript,
  );
  const reanalyzeFromOriginal = useAppStore(
    (s) => s.reanalyzeFromOriginalRawTranscript,
  );
  const navigate = useNavigate();

  // Loading state. The ticketStore cache is hydrated by initStorage() at app
  // boot; we wait one tick before declaring "no tickets" so the empty state
  // doesn't flash on first render.
  useEffect(() => {
    let mounted = true;
    const backend = getStorageBackend();
    if (backend === "uninitialized") {
      const t = setInterval(() => {
        if (getStorageBackend() !== "uninitialized") {
          if (mounted) {
            setLoading(false);
            setRefresh((n) => n + 1);
          }
          clearInterval(t);
        }
      }, 50);
      return () => {
        mounted = false;
        clearInterval(t);
      };
    }
    setLoading(false);
    return () => {
      mounted = false;
    };
  }, []);

  const tickets = useMemo<SavedTicket[]>(() => ticketStore.list(), [refreshTick]);

  // Pre-compute haystacks once per ticket list so search keystrokes only do
  // a string includes per ticket — not a re-flatten of nested objects.
  const indexed = useMemo(
    () => tickets.map((t) => ({ ticket: t, haystack: ticketHaystack(t) })),
    [tickets],
  );

  const filtered = useMemo(() => {
    return indexed
      .filter(({ haystack }) => matchesQuery(haystack, search))
      .filter(({ ticket }) => ticketMatchesFilters(ticket, filters))
      .map((x) => x.ticket);
  }, [indexed, search, filters]);

  const expanded = expandedId ? tickets.find((t) => t.id === expandedId) ?? null : null;

  function refresh() {
    setRefresh((n) => n + 1);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  function exportJson() {
    if (tickets.length === 0) return;
    const blob = new Blob([JSON.stringify(tickets, null, 2)], { type: "application/json" });
    download(blob, `store-tickets-${stamp()}.json`);
    setStatus({ kind: "success", message: `Exported ${tickets.length} ticket(s) to JSON.` });
  }

  function exportCsv() {
    if (tickets.length === 0) return;
    const header = [
      "id",
      "createdAt",
      "storeNumber",
      "callerName",
      "registerNumber",
      "subject",
      "category",
      "subCategory",
      "result",
      "partNeeded",
      "partRequest",
      "transactionNumber",
      "paymentType",
    ];
    const rows = tickets.map((t) => [
      t.id,
      t.createdAt,
      t.details.storeNumber,
      t.details.callerName ?? "",
      t.details.registerNumber,
      t.ticketFields?.subject ?? "",
      t.details.category,
      t.details.subCategory,
      t.details.result,
      t.details.partNeeded ? "yes" : "",
      t.ticketFields?.partRequest ?? "",
      t.details.transactionNumber,
      t.details.paymentType,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvEscape(String(cell ?? ""))).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    download(blob, `store-tickets-${stamp()}.csv`);
    setStatus({ kind: "success", message: `Exported ${tickets.length} ticket(s) to CSV.` });
  }

  async function handleDelete(t: SavedTicket) {
    const subject = t.ticketFields?.subject || t.id;
    const ok = await askConfirm({
      title: "Delete this ticket?",
      message: <>Permanently remove <span className="font-semibold">{subject}</span>? This cannot be undone.</>,
      destructive: true,
      confirmLabel: "Delete ticket",
    });
    if (!ok) return;
    ticketStore.remove(t.id);
    if (expandedId === t.id) setExpandedId(null);
    setStatus({ kind: "success", message: "Ticket deleted." });
    refresh();
  }

  function handleMarkReviewed(t: SavedTicket) {
    ticketStore.setReviewed(t.id, true);
    setStatus({ kind: "success", message: "Ticket marked as reviewed." });
    refresh();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">History</h1>
          <p className="page-subtitle">
            Saved tickets are stored locally on this machine only.
            {tickets.length > 0 && (
              <span className="ml-2 text-slate-500">
                {(search.trim() || isAnyFilterActive(filters))
                  ? `Showing ${filtered.length} of ${tickets.length}`
                  : `${tickets.length} total`}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="search" className="h-3.5 w-3.5" />
            </span>
            <input
              className="input h-9 max-w-xs pl-8 pr-8"
              placeholder="Search subject, transcript, store, error…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearch("");
                }
              }}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                onClick={() => setSearch("")}
              >
                <Icon name="x" className="h-3 w-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowFilters((v) => !v)}
            title="Show or hide the filter panel"
          >
            {showFilters ? "Hide Filters" : "Filters"}
            {isAnyFilterActive(filters) && (
              <span className="ml-1 rounded-full bg-brand-600 px-1.5 py-0 text-[10px] font-semibold text-white">
                on
              </span>
            )}
          </button>
          <button
            className="btn-secondary"
            onClick={exportJson}
            disabled={tickets.length === 0}
            title="Download all saved tickets as JSON"
          >
            Export JSON
          </button>
          <button
            className="btn-secondary"
            onClick={exportCsv}
            disabled={tickets.length === 0}
            title="Download a CSV of all saved tickets"
          >
            Export CSV
          </button>
        </div>
      </header>

      {showFilters && (
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          onClear={clearFilters}
          totalCount={tickets.length}
          filteredCount={filtered.length}
        />
      )}

      {loading && (
        <div className="card space-y-3">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && tickets.length === 0 && (
        <EmptyState
          icon="clock"
          title="No saved tickets yet"
          description="Record a call (or paste a transcript), generate the note, and click Save Ticket — every saved ticket lands here for search, export, and re-analysis."
          cta={{ label: "Record your first call", to: "/voice" }}
          secondary={
            <>
              You can also enable <Link className="underline" to="/settings">auto-save</Link> in Settings.
            </>
          }
        />
      )}

      {!loading && <OrphanRecordingsPanel />}

      {!loading && tickets.length > 0 && filtered.length === 0 && (
        <EmptyState
          icon="search"
          title="No tickets match"
          description={
            <>
              Nothing in <span className="font-mono">{search.trim() || "the active filter"}</span>.
              Clear search and filters to see all {tickets.length} ticket{tickets.length === 1 ? "" : "s"}.
            </>
          }
          cta={{
            label: "Clear search & filters",
            onClick: () => {
              setSearch("");
              clearFilters();
            },
          }}
        />
      )}

      <section className="space-y-3">
        {filtered.map((t) => {
          const subject = t.ticketFields?.subject || `Store ${t.details.storeNumber || "?"}`;
          const isExpanded = expandedId === t.id;
          return (
            <div key={t.id} className="card flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium text-slate-900 dark:text-slate-100">{subject}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {formatDateTime(t.createdAt)}
                </span>
              </div>
              <TicketBadges ticket={t} />
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                {t.ticketFields?.description || t.generatedTicket || t.details.issue || "(no description)"}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    loadTicket(t.id);
                    navigate("/form");
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    loadTicket(t.id);
                    navigate("/ticket");
                  }}
                >
                  Open Note
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  title="View transcripts, audit trail, and re-run options"
                >
                  {isExpanded ? "Hide Inspect" : "Inspect"}
                </button>
              </div>
              {isExpanded && expanded && expanded.id === t.id && (
                <ErrorBoundary
                  fallbackTitle="Couldn't render this ticket's inspect view."
                  fallbackHint="The ticket data may be malformed. Other tickets are still available above."
                  retryLabel="Retry"
                  onRetry={() => setExpandedId(null)}
                >
                  <TicketInspectView
                    ticket={expanded}
                    onReanalyzeFromSavedSpeaker={async () => {
                      loadTicket(t.id);
                      await reanalyzeFromSavedSpeaker();
                      navigate("/form");
                    }}
                    onReanalyzeFromOriginal={async () => {
                      loadTicket(t.id);
                      await reanalyzeFromOriginal();
                      navigate("/form");
                    }}
                    onMarkReviewed={() => handleMarkReviewed(t)}
                    onDelete={() => handleDelete(t)}
                    onChange={refresh}
                  />
                </ErrorBoundary>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

interface FilterPanelProps {
  filters: HistoryFilters;
  onChange: (next: HistoryFilters) => void;
  onClear: () => void;
  totalCount: number;
  filteredCount: number;
}

function FilterPanel({
  filters,
  onChange,
  onClear,
  totalCount,
  filteredCount,
}: FilterPanelProps) {
  function set<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) {
    onChange({ ...filters, [key]: value });
  }
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Filters</h2>
        <span className="text-xs text-slate-500">
          Showing {filteredCount} of {totalCount}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Store number
          <input
            className="input mt-1 w-full"
            placeholder="e.g. 521"
            value={filters.storeNumber}
            onChange={(e) => set("storeNumber", e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Result
          <select
            className="input mt-1 w-full"
            value={filters.result}
            onChange={(e) => set("result", e.target.value as HistoryFilters["result"])}
          >
            <option value="">Any</option>
            {TICKET_RESULTS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Category
          <input
            className="input mt-1 w-full"
            placeholder="contains…"
            value={filters.category}
            onChange={(e) => set("category", e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Sub-category
          <input
            className="input mt-1 w-full"
            placeholder="contains…"
            value={filters.subCategory}
            onChange={(e) => set("subCategory", e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Date from
          <input
            type="date"
            className="input mt-1 w-full"
            value={filters.dateFrom}
            onChange={(e) => set("dateFrom", e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Date to
          <input
            type="date"
            className="input mt-1 w-full"
            value={filters.dateTo}
            onChange={(e) => set("dateTo", e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Extractor version
          <select
            className="input mt-1 w-full"
            value={filters.extractorVersion}
            onChange={(e) =>
              set("extractorVersion", e.target.value as HistoryFilters["extractorVersion"])
            }
          >
            <option value="any">Any</option>
            <option value="current">Current</option>
            <option value="older">Older</option>
            <option value="legacy">Legacy</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <TriStateField
          label="Has audio"
          value={filters.hasAudio}
          onChange={(v) => set("hasAudio", v)}
        />
        <TriStateField
          label="Has speaker transcript"
          value={filters.hasSpeakerTranscript}
          onChange={(v) => set("hasSpeakerTranscript", v)}
        />
        <TriStateField
          label="Has correction audit"
          value={filters.hasCorrectionAudit}
          onChange={(v) => set("hasCorrectionAudit", v)}
        />
        <TriStateField
          label="Has part request"
          value={filters.hasPartRequest}
          onChange={(v) => set("hasPartRequest", v)}
        />
        <TriStateField
          label="Has name correction"
          value={filters.hasNameCorrection}
          onChange={(v) => set("hasNameCorrection", v)}
        />
        <TriStateField
          label="Reviewed"
          value={filters.reviewed}
          onChange={(v) => set("reviewed", v)}
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClear}
          disabled={!isAnyFilterActive(filters)}
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}

function TriStateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TriState;
  onChange: (v: TriState) => void;
}) {
  return (
    <label className="text-xs text-slate-600 dark:text-slate-300">
      {label}
      <select
        className="input mt-1 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value as TriState)}
      >
        <option value="any">Any</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
