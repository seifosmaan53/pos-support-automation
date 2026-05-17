/**
 * Phase 6 reminder types.
 *
 * Status model: a single canonical `status` plus a `snoozeUntil` timestamp.
 * Snoozed is its own status (so the Reminders page can group it) but resuming
 * is implicit — once `now >= snoozeUntil` the app flips the row back to "open".
 * That keeps "do I need to act on this?" a single field check downstream.
 *
 * `dueAt`, `snoozeUntil`, `completedAt`, `dismissedAt` are stored as ISO 8601
 * strings (the SQLite columns hold TEXT). Empty / unset → undefined, never "".
 */

export type ReminderStatus = "open" | "completed" | "dismissed" | "snoozed";

export interface Reminder {
  id: string;
  /** ID of the saved ticket this reminder follows up on, if any. */
  ticketId: string;
  /** Convenience copy so the Reminders page can filter by store without joining. */
  storeNumber: string;
  title: string;
  message: string;
  /** When the reminder is meant to fire. Optional for "someday" reminders. */
  dueAt?: string;
  status: ReminderStatus;
  /** Only meaningful when status==="snoozed". When `now >= snoozeUntil` the
   *  reminder auto-flips back to "open". */
  snoozeUntil?: string;
  createdAt: string;
  completedAt?: string;
  dismissedAt?: string;
}

/**
 * Suggestion surfaced by `reminderIntelligence.suggestRemindersForCurrent`.
 * The user can accept (Create) or Dismiss each one. Suggestions are advisory
 * — never auto-saved unless `reminderSettings.autoCreateFromTranscript` is on.
 */
export interface ReminderSuggestion {
  /** Stable key for React rendering and for "dismiss this suggestion". Built
   *  from the suggestion's reason+target so the same trigger doesn't surface
   *  twice on the same page. */
  key: string;
  title: string;
  message: string;
  /** Suggested due time (ISO). Tomorrow morning by default for follow-ups. */
  dueAt: string;
  /** Short reason shown to the user — eg. "Result is Pending" or
   *  "Transcript said 'call back tomorrow'". */
  reason: string;
}

/**
 * Persisted reminder preferences. Lives on `AppSettings.reminderSettings`.
 * `autoCreateFromTranscript` is OFF by default per the spec — the app only
 * suggests, never silently creates, unless the user opts in.
 */
export interface ReminderSettings {
  enableReminders: boolean;
  showBanner: boolean;
  /** Reserved for a future Tauri notification plugin. Currently has no effect
   *  beyond a "not supported in this version" hint in Settings. */
  enableDesktopNotifications: boolean;
  autoCreateFromTranscript: boolean;
  /** Hours added to "now" for the default follow-up time. */
  defaultFollowUpHours: number;
  /** Minutes added to "now" for a quick snooze. */
  defaultSnoozeMinutes: number;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enableReminders: true,
  showBanner: true,
  enableDesktopNotifications: false,
  autoCreateFromTranscript: false,
  defaultFollowUpHours: 16,
  defaultSnoozeMinutes: 30,
};
