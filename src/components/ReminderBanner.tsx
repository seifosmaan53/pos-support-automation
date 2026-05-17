import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { remindersStore } from "../services/remindersStore";
import { inMinutes } from "../services/reminderIntelligence";
import { formatDateTime } from "../utils/formatDate";
import type { Reminder } from "../types/reminder";
import { Icon } from "./Icon";

/**
 * Phase 6 in-app banner. Sits above the main content area in `Layout` and
 * shows up when there are due/overdue reminders the user hasn't acted on.
 *
 * Behaviour:
 *   • A 60-second timer ticks state forward; on each tick we auto-resume
 *     any snoozed reminders whose snooze window has elapsed, then re-pull
 *     `dueSoon()` so the banner reflects current state.
 *   • Each due reminder gets a Mark Complete + Snooze button so common
 *     actions don't require leaving the current page.
 *   • A "View all" link goes to /reminders for the full list.
 *   • The banner respects `reminderSettings.showBanner` — when off, it
 *     renders nothing even if there are overdue items.
 *
 * Desktop notifications are intentionally not wired up: per the spec, this
 * phase is in-app-only because the Tauri notification plugin isn't part of
 * the project's dependencies. The Settings page makes that explicit.
 */
export function ReminderBanner() {
  const settings = useAppStore((s) => s.settings);
  const complete = useAppStore((s) => s.completeReminder);
  const snooze = useAppStore((s) => s.snoozeReminder);
  const resumeExpired = useAppStore((s) => s.resumeExpiredReminderSnoozes);
  const navigate = useNavigate();

  const [tick, setTick] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    resumeExpired();
    const id = window.setInterval(() => {
      resumeExpired();
      setTick((n) => n + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [resumeExpired]);

  if (!settings.reminderSettings.enableReminders) return null;
  if (!settings.reminderSettings.showBanner) return null;

  void tick;
  const due: Reminder[] = remindersStore.dueSoon(0);
  if (due.length === 0) return null;

  const snoozeMins = settings.reminderSettings.defaultSnoozeMinutes || 30;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="group flex w-full items-center justify-between border-b border-amber-200/80 bg-amber-50/80 px-5 py-1.5 text-xs text-amber-900 backdrop-blur-md transition-colors hover:bg-amber-100/80 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/40"
        title="Show due reminders"
      >
        <span className="flex items-center gap-2">
          <Icon name="bell" className="h-3.5 w-3.5" />
          <span>
            <strong>{due.length}</strong> reminder{due.length === 1 ? " is" : "s are"} due now
          </span>
        </span>
        <span className="text-[11px] font-medium opacity-80 group-hover:opacity-100">Show</span>
      </button>
    );
  }

  return (
    <section
      className="border-b border-amber-200/80 bg-amber-50/80 px-5 py-3 text-sm text-amber-900 backdrop-blur-md dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100"
      role="region"
      aria-label="Due reminders"
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-amber-200/70 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200">
            <Icon name="bell" className="h-3.5 w-3.5" />
          </span>
          <strong className="text-sm">
            {due.length} reminder{due.length === 1 ? "" : "s"} due now
          </strong>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium hover:bg-amber-100/80 dark:hover:bg-amber-900/50"
            onClick={() => navigate("/reminders")}
          >
            View all
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium hover:bg-amber-100/80 dark:hover:bg-amber-900/50"
            onClick={() => setCollapsed(true)}
            title="Collapse this banner for the rest of the session."
          >
            Collapse
          </button>
        </div>
      </header>
      <ul className="space-y-1.5">
        {due.slice(0, 4).map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/70 bg-white/70 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-950/30"
          >
            <span className="font-medium">{r.title}</span>
            {r.storeNumber && (
              <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-900/60 dark:text-amber-100">
                Store {r.storeNumber}
              </span>
            )}
            {r.dueAt && (
              <span className="text-xs text-amber-800/90 dark:text-amber-200/90">
                Due {formatDateTime(r.dueAt)}
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-1">
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
                onClick={() => complete(r.id)}
                title="Mark this reminder as completed."
              >
                <Icon name="check" className="h-3 w-3" />
                Complete
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md border border-amber-300 bg-white/70 px-2.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
                onClick={() => snooze(r.id, inMinutes(snoozeMins))}
                title={`Snooze for ${snoozeMins} minutes.`}
              >
                Snooze {snoozeMins}m
              </button>
            </div>
          </li>
        ))}
        {due.length > 4 && (
          <li className="px-3 py-0.5 text-xs italic opacity-80">
            +{due.length - 4} more — open Reminders to see them all.
          </li>
        )}
      </ul>
    </section>
  );
}
