/**
 * Phase 13 — Daily Start page.
 *
 * The new "/" landing. Designed so the most common daily intent — "answer a
 * call, take a ticket" — is one click away, with the small set of operational
 * facts a user wants at a glance (recent activity, due reminders, last
 * backup, audio health). Advanced analytics live under their own routes.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { ticketStore } from "../services/databaseService";
import { remindersStore } from "../services/remindersStore";
import { audioFilesStore } from "../services/audioFilesStore";
import { getLastBackupAt } from "../services/backupService";
import { Icon, type IconName } from "../components/Icon";
import { StartupWarningBanner } from "../components/StartupWarningBanner";
import { formatDateTime } from "../utils/formatDate";
import type { SavedTicket } from "../types/ticket";
import type { Reminder } from "../types/reminder";

interface AudioHealthSummary {
  active: number;
  deleted: number;
  // The exact "missing"/"orphan" counts require Tauri probes; on the Home
  // page we keep things cheap — just SQLite-derivable counts. The user can
  // open System Health for the full picture.
}

function summarizeAudioHealth(): AudioHealthSummary {
  const all = audioFilesStore.list();
  return {
    active: all.filter((a) => !a.deleted).length,
    deleted: all.filter((a) => a.deleted).length,
  };
}

function recentTickets(n: number): SavedTicket[] {
  return ticketStore.list().slice(0, n);
}

function dueReminders(): Reminder[] {
  return remindersStore.dueSoon(0);
}

export function HomePage() {
  const settings = useAppStore((s) => s.settings);
  const [, setTick] = useState(0);

  // Re-render every minute so "due now" reminders surface as time passes
  // without the user having to refresh.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Reminders are quick to compute and depend on the cache only, so we read
  // them inline. Same for tickets and audio counts.
  const recent = useMemo(() => recentTickets(5), []);
  const due = useMemo(() => dueReminders(), []);
  const audio = useMemo(() => summarizeAudioHealth(), []);
  const lastBackup = getLastBackupAt();
  const technicianName = settings.technicianName?.trim() || "there";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <StartupWarningBanner />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Hi {technicianName} — ready to take a call?</h1>
          <p className="page-subtitle">
            Start a new ticket, pick up a recent one, or check on the things
            that need attention.
          </p>
        </div>
        <Link to="/voice" className="btn-primary text-sm">
          New Ticket
        </Link>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <QuickActions />
        <StatusSummary
          lastBackup={lastBackup}
          audio={audio}
          dueCount={due.length}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <RecentTicketsCard tickets={recent} />
        <RemindersCard reminders={due} />
      </section>
    </div>
  );
}

function QuickActions() {
  const buttons: { to: string; label: string; icon: IconName; desc: string }[] = [
    { to: "/voice", label: "New Ticket", icon: "mic", desc: "Record or paste a call" },
    { to: "/history", label: "History", icon: "clock", desc: "Saved tickets" },
    {
      to: "/system",
      label: "Run Health Check",
      icon: "shield",
      desc: "Storage, audio, backup",
    },
    {
      to: "/system",
      label: "Export Backup",
      icon: "doc",
      desc: "JSON + optional audio bundle",
    },
  ];
  return (
    <div className="card space-y-2">
      <h2 className="text-base font-semibold">Quick actions</h2>
      <div className="grid grid-cols-2 gap-2">
        {buttons.map((b) => (
          <Link
            key={b.label}
            to={b.to}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
          >
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200">
              <Icon name={b.icon} className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium">{b.label}</div>
              <div className="truncate text-xs text-slate-500">{b.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusSummary({
  lastBackup,
  audio,
  dueCount,
}: {
  lastBackup: string | null;
  audio: AudioHealthSummary;
  dueCount: number;
}) {
  const rows: { label: string; value: string; tone: "ok" | "warning" | "neutral"; to?: string }[] = [
    {
      label: "Last backup",
      value: lastBackup ? formatDateTime(lastBackup) : "never",
      tone: lastBackup
        ? Date.now() - new Date(lastBackup).getTime() > 30 * 24 * 60 * 60 * 1000
          ? "warning"
          : "ok"
        : "warning",
      to: "/system",
    },
    {
      label: "Audio rows (active)",
      value: String(audio.active),
      tone: "neutral",
      to: "/system",
    },
    {
      label: "Audio rows (deleted)",
      value: String(audio.deleted),
      tone: audio.deleted > 0 ? "neutral" : "neutral",
      to: "/system",
    },
    {
      label: "Reminders due now",
      value: String(dueCount),
      tone: dueCount > 0 ? "warning" : "ok",
      to: "/reminders",
    },
  ];
  return (
    <div className="card space-y-2">
      <h2 className="text-base font-semibold">Daily status</h2>
      <dl className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2">
            <dt className="text-xs text-slate-500">{r.label}</dt>
            <dd className="flex items-center gap-2">
              <span
                className={
                  r.tone === "ok"
                    ? "text-emerald-700 dark:text-emerald-300"
                    : r.tone === "warning"
                      ? "text-amber-700 dark:text-amber-300"
                      : ""
                }
              >
                {r.value}
              </span>
              {r.to && (
                <Link
                  to={r.to}
                  className="text-xs text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                >
                  view
                </Link>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RecentTicketsCard({ tickets }: { tickets: SavedTicket[] }) {
  if (tickets.length === 0) {
    return (
      <div className="card space-y-1">
        <h2 className="text-base font-semibold">Recent tickets</h2>
        <p className="text-xs text-slate-500">
          No saved tickets yet. Take your first call to see it here.
        </p>
        <Link to="/voice" className="btn-ghost mt-1 inline-block text-xs">
          New Ticket
        </Link>
      </div>
    );
  }
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Recent tickets</h2>
        <Link to="/history" className="text-xs text-brand-700 hover:underline dark:text-brand-300">
          See all
        </Link>
      </div>
      <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
        {tickets.map((t) => {
          const subj =
            t.ticketFields?.subject?.trim() ||
            t.details?.issue?.trim() ||
            `Ticket ${t.id.slice(0, 8)}`;
          const meta = [
            t.details?.storeNumber ? `Store ${t.details.storeNumber}` : null,
            t.details?.category || null,
            t.details?.result ? `${t.details.result}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{subj}</div>
                <div className="truncate text-xs text-slate-500">
                  {formatDateTime(t.createdAt)}
                  {meta ? ` · ${meta}` : ""}
                </div>
              </div>
              <Link to="/history" className="btn-ghost text-xs">
                Open
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RemindersCard({ reminders }: { reminders: Reminder[] }) {
  if (reminders.length === 0) {
    return (
      <div className="card space-y-1">
        <h2 className="text-base font-semibold">Due reminders</h2>
        <p className="text-xs text-slate-500">
          Nothing due. New reminders show up here as their time comes due.
        </p>
        <Link to="/reminders" className="btn-ghost mt-1 inline-block text-xs">
          See all reminders
        </Link>
      </div>
    );
  }
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Due reminders ({reminders.length})
        </h2>
        <Link to="/reminders" className="text-xs text-brand-700 hover:underline dark:text-brand-300">
          Manage
        </Link>
      </div>
      <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
        {reminders.slice(0, 5).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{r.title}</div>
              <div className="truncate text-xs text-slate-500">
                {r.storeNumber ? `Store ${r.storeNumber} · ` : ""}
                {r.dueAt ? `due ${formatDateTime(r.dueAt)}` : "no due time"}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
