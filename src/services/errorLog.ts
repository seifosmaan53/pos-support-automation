/**
 * Phase 12 — central error log.
 *
 * Existing modules (databaseService, audioFilesStore, etc.) already kept
 * their own small `recentErrors` arrays. This module is the one place every
 * subsystem reports into, so the System Health page can show a single
 * timeline and the backup tool can export the log to disk.
 *
 * Storage: in-memory ring buffer of {cap} entries, mirrored to localStorage
 * so the log survives reloads. We deliberately do NOT persist to SQLite —
 * if SQLite itself is broken (which is the failure case that most needs
 * logging), persisting through it would suppress its own errors.
 */

export type ErrorSeverity = "info" | "warning" | "error";

export type ErrorSource =
  | "storage"
  | "audio"
  | "whisper"
  | "ai"
  | "backup"
  | "restore"
  | "migration"
  | "ui"
  | "startup"
  | "other";

export interface ErrorLogEntry {
  id: string;
  at: string;
  source: ErrorSource;
  op: string;
  message: string;
  severity: ErrorSeverity;
  /** Optional structured context — JSON-serializable. */
  context?: Record<string, unknown>;
}

const LS_KEY = "sta.error_log.v1";
const CAP = 200;

const entries: ErrorLogEntry[] = [];
const listeners = new Set<() => void>();
let hydrated = false;

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as ErrorLogEntry[];
    if (!Array.isArray(parsed)) return;
    for (const e of parsed) {
      if (e && typeof e.message === "string") entries.push(e);
    }
  } catch {
    // ignore — a corrupt log isn't a crash-worthy condition
  }
}

function persist(): void {
  if (typeof localStorage === "undefined") return;
  if (typeof (localStorage as Storage).setItem !== "function") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded — persist only what fits, without mutating the
    // in-memory buffer. The in-memory cap is the source of truth; localStorage
    // is best-effort persistence.
    let toPersist = entries.slice(0, Math.max(10, Math.floor(entries.length / 2)));
    while (toPersist.length > 0) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(toPersist));
        return;
      } catch {
        toPersist = toPersist.slice(0, Math.floor(toPersist.length / 2));
      }
    }
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // listener faults must not bring down the logger
    }
  }
}

export interface LogInput {
  source: ErrorSource;
  op: string;
  message: string;
  severity?: ErrorSeverity;
  context?: Record<string, unknown>;
}

export function logError(input: LogInput): ErrorLogEntry {
  hydrate();
  const entry: ErrorLogEntry = {
    id: shortId(),
    at: nowIso(),
    source: input.source,
    op: input.op,
    message: input.message,
    severity: input.severity ?? "error",
    context: input.context,
  };
  entries.unshift(entry);
  if (entries.length > CAP) entries.length = CAP;
  persist();
  notify();
  return entry;
}

export function getErrorLog(): ErrorLogEntry[] {
  hydrate();
  return [...entries];
}

export function getRecentErrors(source?: ErrorSource, limit = 5): ErrorLogEntry[] {
  hydrate();
  const list = source ? entries.filter((e) => e.source === source) : entries;
  return list.slice(0, Math.max(0, limit));
}

export function clearErrorLog(): void {
  hydrate();
  entries.length = 0;
  persist();
  notify();
}

/**
 * Subscribe to log mutations. Returns an unsubscribe function. Used by the
 * System Health page so the "Error log" panel updates live without polling.
 */
export function subscribeErrorLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Convenience: format the log as plain text for clipboard / file export.
 * One line per entry, severity-prefixed so a glance at the file tells you
 * how bad things are.
 */
export function formatErrorLog(): string {
  hydrate();
  if (entries.length === 0) return "(error log empty)";
  return entries
    .map((e) => {
      const sev = e.severity.toUpperCase().padEnd(7);
      const src = e.source.padEnd(9);
      return `[${e.at}] ${sev} ${src} ${e.op}: ${e.message}`;
    })
    .join("\n");
}

/**
 * Test-only — wipe the in-memory buffer AND localStorage so a test suite
 * doesn't accumulate cross-test noise. Not part of the production API.
 */
export function __resetErrorLog(): void {
  entries.length = 0;
  hydrated = false;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }
}
