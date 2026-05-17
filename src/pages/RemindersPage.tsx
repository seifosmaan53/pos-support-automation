import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { remindersStore } from "../services/remindersStore";
import { useAppStore } from "../services/appStore";
import { ticketStore } from "../services/databaseService";
import { WarningBox } from "../components/WarningBox";
import { ReminderQuickButtons } from "../components/ReminderQuickButtons";
import { formatDateTime } from "../utils/formatDate";
import {
  inMinutes,
  tomorrowMorning,
} from "../services/reminderIntelligence";
import type { Reminder, ReminderStatus } from "../types/reminder";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";

/**
 * Phase 6 Reminders page.
 *
 * Filter buttons match the spec exactly: All / Open / Due Today / Overdue /
 * Snoozed / Completed / Dismissed / By Store. Each row exposes Mark
 * Complete, Snooze 30 Minutes, Snooze Tomorrow, Dismiss, Delete, and
 * (when linked to a saved ticket) Open Related Ticket — which drops the
 * user into History with a focus query on that ticket id.
 *
 * Related-ticket subjects are looked up against `ticketStore` synchronously
 * because that cache is hydrated at boot. If the ticket has been deleted
 * since the reminder was created, we fall back to "(ticket no longer in
 * history)" rather than hiding the badge — the user still wants to know
 * the link existed.
 *
 * Snoozed → Open auto-resume happens transparently via `remindersStore`'s
 * `resumeExpiredSnoozes()` which we call on every render; the banner does
 * the same on its 60-second timer.
 */

type Filter =
  | "all"
  | "open"
  | "dueToday"
  | "overdue"
  | "snoozed"
  | "completed"
  | "dismissed"
  | "byStore";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  open: "Open",
  dueToday: "Due Today",
  overdue: "Overdue",
  snoozed: "Snoozed",
  completed: "Completed",
  dismissed: "Dismissed",
  byStore: "By Store",
};

const STATUS_TONE: Record<ReminderStatus, string> = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  snoozed: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  completed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  dismissed:
    "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

function isSameLocalDay(iso: string, ref = new Date()): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const d = new Date(t);
  return d.toDateString() === ref.toDateString();
}

function isOverdue(r: Reminder, now = Date.now()): boolean {
  if (r.status !== "open") return false;
  if (!r.dueAt) return false;
  const t = Date.parse(r.dueAt);
  return Number.isFinite(t) && t < now;
}

export function RemindersPage() {
  const navigate = useNavigate();
  const setStatus = useAppStore((s) => s.setStatus);
  const complete = useAppStore((s) => s.completeReminder);
  const snooze = useAppStore((s) => s.snoozeReminder);
  const dismiss = useAppStore((s) => s.dismissReminder);
  const reopen = useAppStore((s) => s.reopenReminder);
  const remove = useAppStore((s) => s.deleteReminder);
  const settings = useAppStore((s) => s.settings);
  const askConfirm = useConfirm();

  const [refreshTick, setRefreshTick] = useState(0);
  const [filter, setFilter] = useState<Filter>("open");
  const [storeFilter, setStoreFilter] = useState("");

  // On every render: sweep elapsed snoozes back to open. Cheap (linear over
  // the cache) and means navigating to this page never shows stale state.
  useEffect(() => {
    const resumed = remindersStore.resumeExpiredSnoozes();
    if (resumed.length > 0) {
      setRefreshTick((n) => n + 1);
    }
  }, []);

  function refresh() {
    setRefreshTick((n) => n + 1);
  }

  const reminders = useMemo(() => {
    void refreshTick;
    const all = remindersStore.list();
    const now = Date.now();
    const todayIso = new Date(now).toISOString();
    switch (filter) {
      case "all":
        return all;
      case "open":
        return all.filter((r) => r.status === "open");
      case "snoozed":
        return all.filter((r) => r.status === "snoozed");
      case "completed":
        return all.filter((r) => r.status === "completed");
      case "dismissed":
        return all.filter((r) => r.status === "dismissed");
      case "dueToday":
        return all.filter(
          (r) =>
            (r.status === "open" || r.status === "snoozed") &&
            r.dueAt &&
            isSameLocalDay(r.dueAt, new Date(todayIso)),
        );
      case "overdue":
        return all.filter((r) => isOverdue(r, now));
      case "byStore": {
        const q = storeFilter.trim().toLowerCase();
        if (!q) return all;
        return all.filter((r) => r.storeNumber.toLowerCase().includes(q));
      }
    }
  }, [refreshTick, filter, storeFilter]);

  const counts = useMemo(() => {
    void refreshTick;
    const all = remindersStore.list();
    const now = Date.now();
    return {
      all: all.length,
      open: all.filter((r) => r.status === "open").length,
      snoozed: all.filter((r) => r.status === "snoozed").length,
      completed: all.filter((r) => r.status === "completed").length,
      dismissed: all.filter((r) => r.status === "dismissed").length,
      overdue: all.filter((r) => isOverdue(r, now)).length,
      dueToday: all.filter(
        (r) =>
          (r.status === "open" || r.status === "snoozed") &&
          r.dueAt &&
          isSameLocalDay(r.dueAt),
      ).length,
    };
  }, [refreshTick]);

  function handleComplete(r: Reminder) {
    complete(r.id);
    refresh();
  }
  function handleSnooze30(r: Reminder) {
    snooze(r.id, inMinutes(settings.reminderSettings.defaultSnoozeMinutes || 30));
    refresh();
  }
  function handleSnoozeTomorrow(r: Reminder) {
    snooze(r.id, tomorrowMorning());
    refresh();
  }
  function handleDismiss(r: Reminder) {
    dismiss(r.id);
    refresh();
  }
  function handleReopen(r: Reminder) {
    reopen(r.id);
    refresh();
  }
  async function handleDelete(r: Reminder) {
    if (settings.askBeforeDelete) {
      const ok = await askConfirm({
        title: "Delete this reminder?",
        message: <>Permanently remove <span className="font-semibold">{r.title}</span>?</>,
        destructive: true,
      });
      if (!ok) return;
    }
    remove(r.id);
    refresh();
  }
  function handleOpenTicket(r: Reminder) {
    if (!r.ticketId) {
      setStatus({
        kind: "info",
        message: "This reminder isn't linked to a saved ticket.",
      });
      return;
    }
    // History page reads ticket IDs out of the URL search; using a query
    // string is safer than relying on hash routing edge cases.
    navigate(`/history?focus=${encodeURIComponent(r.ticketId)}`);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="page-title">Reminders</h1>
        <p className="page-subtitle">
          Local follow-ups for stores, tickets, parts, and vendor calls. Snoozed
          items resume automatically when their snooze window elapses.
        </p>
      </header>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Quick Create</h2>
        <p className="text-xs text-slate-500">
          These create a reminder linked to the currently-loaded ticket if there
          is one. Use the form below for free-form reminders.
        </p>
        <ReminderQuickButtons />
      </section>

      <section className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Filter:</span>
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => {
            const active = filter === f;
            const count =
              f === "all"
                ? counts.all
                : f === "open"
                  ? counts.open
                  : f === "snoozed"
                    ? counts.snoozed
                    : f === "completed"
                      ? counts.completed
                      : f === "dismissed"
                        ? counts.dismissed
                        : f === "overdue"
                          ? counts.overdue
                          : f === "dueToday"
                            ? counts.dueToday
                            : null;
            return (
              <button
                key={f}
                type="button"
                className={`rounded-full px-3 py-1 text-xs ${
                  active
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                }`}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]}
                {count !== null && (
                  <span className="ml-1 text-[10px] opacity-70">({count})</span>
                )}
              </button>
            );
          })}
        </div>
        {filter === "byStore" && (
          <div>
            <label className="label mb-1">Store number contains</label>
            <input
              className="input max-w-xs"
              placeholder="e.g. 521"
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
            />
          </div>
        )}
      </section>

      {reminders.length === 0 ? (
        filter === "all" ? (
          <EmptyState
            icon="bell"
            title="No reminders yet"
            description="Create follow-ups from a saved ticket on Form Helper, use Quick Create above, or auto-generate from extracted details."
            cta={{ label: "Open Form Helper", to: "/form" }}
          />
        ) : (
          <EmptyState
            icon="bell"
            title={`No reminders in "${FILTER_LABEL[filter]}"`}
            description="Try a different filter, or switch to All to see every reminder."
            cta={{ label: "Show all", onClick: () => setFilter("all") }}
          />
        )
      ) : (
        <section className="space-y-2">
          {reminders.map((r) => (
            <ReminderRow
              key={r.id}
              reminder={r}
              onComplete={() => handleComplete(r)}
              onSnooze30={() => handleSnooze30(r)}
              onSnoozeTomorrow={() => handleSnoozeTomorrow(r)}
              onDismiss={() => handleDismiss(r)}
              onReopen={() => handleReopen(r)}
              onDelete={() => handleDelete(r)}
              onOpenTicket={() => handleOpenTicket(r)}
              snoozeMinutes={settings.reminderSettings.defaultSnoozeMinutes || 30}
            />
          ))}
        </section>
      )}
    </div>
  );
}

interface RowProps {
  reminder: Reminder;
  onComplete: () => void;
  onSnooze30: () => void;
  onSnoozeTomorrow: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onOpenTicket: () => void;
  snoozeMinutes: number;
}

function ReminderRow({
  reminder: r,
  onComplete,
  onSnooze30,
  onSnoozeTomorrow,
  onDismiss,
  onReopen,
  onDelete,
  onOpenTicket,
  snoozeMinutes,
}: RowProps) {
  const ticketSubject = useMemo(() => {
    if (!r.ticketId) return "";
    const t = ticketStore.get(r.ticketId);
    if (!t) return "(ticket no longer in history)";
    return t.ticketFields?.subject || t.details?.issue || "(no subject)";
  }, [r.ticketId]);

  const overdue = isOverdue(r);
  const isClosed = r.status === "completed" || r.status === "dismissed";

  return (
    <div className="card flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status]}`}>
          {r.status}
        </span>
        <span className="font-semibold">{r.title}</span>
        {r.storeNumber && (
          <span className="rounded bg-brand-100 px-2 py-0.5 text-xs text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
            Store {r.storeNumber}
          </span>
        )}
        {r.dueAt && (
          <span
            className={`text-xs ${
              overdue ? "font-medium text-red-700 dark:text-red-300" : "text-slate-500"
            }`}
            title={overdue ? "Overdue" : "Scheduled due time"}
          >
            Due: {formatDateTime(r.dueAt)}
            {overdue ? " · overdue" : ""}
          </span>
        )}
        {r.status === "snoozed" && r.snoozeUntil && (
          <span className="text-xs text-sky-700 dark:text-sky-200">
            Snoozed until {formatDateTime(r.snoozeUntil)}
          </span>
        )}
        {r.completedAt && (
          <span className="text-xs text-emerald-700 dark:text-emerald-200">
            Completed {formatDateTime(r.completedAt)}
          </span>
        )}
        {r.dismissedAt && (
          <span className="text-xs text-slate-500">
            Dismissed {formatDateTime(r.dismissedAt)}
          </span>
        )}
      </div>
      {r.message && (
        <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
          {r.message}
        </div>
      )}
      {ticketSubject && (
        <div className="text-xs text-slate-500">
          Linked ticket: <span className="font-medium">{ticketSubject}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!isClosed && (
          <button className="btn-secondary text-xs" onClick={onComplete}>
            Mark Complete
          </button>
        )}
        {r.status === "open" && (
          <>
            <button className="btn-ghost text-xs" onClick={onSnooze30}>
              Snooze {snoozeMinutes} Minutes
            </button>
            <button className="btn-ghost text-xs" onClick={onSnoozeTomorrow}>
              Snooze Tomorrow
            </button>
          </>
        )}
        {!isClosed && (
          <button className="btn-ghost text-xs" onClick={onDismiss}>
            Dismiss
          </button>
        )}
        {isClosed && (
          <button className="btn-ghost text-xs" onClick={onReopen}>
            Reopen
          </button>
        )}
        <button
          className="btn-ghost text-xs"
          onClick={onOpenTicket}
          disabled={!r.ticketId}
          title={
            r.ticketId
              ? "Open the related ticket in History."
              : "This reminder isn't linked to a saved ticket."
          }
        >
          Open Related Ticket
        </button>
        <button className="btn-danger ml-auto text-xs" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
