/**
 * Phase 6: SQLite-backed reminders store.
 *
 * The Phase 1 schema already includes the `reminders` table — Phase 6 just
 * wires reads + writes through it. The public API stays synchronous because
 * the rest of the app (RemindersPage, banner, panel) reads inside `useMemo`
 * and writes inside event handlers; making this async would cascade.
 *
 * Strategy mirrors `ticketFeedbackStore.ts`:
 *   • In-memory `cache` keyed by id → Reminder.
 *   • A boot-time `initRemindersStore()` hydrates from SQLite if Tauri is
 *     available, otherwise from localStorage.
 *   • Writes update the cache synchronously and enqueue an async SQLite
 *     write through a shared promise queue (no concurrent writes can race).
 *
 * Legacy migration: any reminders previously persisted to
 * `localStorage[sta.reminders.v1]` (the Phase 5 store) are imported once on
 * the first Tauri boot and then ignored. The localStorage key is left in
 * place so a downgrade still has data — the SQLite row is the new authority.
 */
import type { Reminder, ReminderStatus } from "../types/reminder";
import { newId, nowIso } from "../utils/formatDate";
import { getDatabase, isTauriAvailable } from "./sqliteClient";

const LS_KEY = "sta.reminders.v1";

interface ReminderRow {
  id: string;
  ticket_id: string | null;
  store_number: string;
  title: string;
  message: string;
  due_at: string | null;
  status: string;
  snooze_until: string | null;
  created_at: string;
  /** Newer columns added by the v3→v4 migration. May be undefined for legacy rows. */
  completed_at?: string | null;
  dismissed_at?: string | null;
}

const cache = new Map<string, Reminder>();
let backend: "sqlite" | "localStorage" | "uninitialized" = "uninitialized";
let initialized = false;
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(() => fn()).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[remindersStore] ${label} failed:`, e);
  }) as Promise<T>;
  writeQueue = next;
  return next;
}

function decodeStatus(s: string | null | undefined): ReminderStatus {
  if (s === "completed") return "completed";
  if (s === "dismissed") return "dismissed";
  if (s === "snoozed") return "snoozed";
  return "open";
}

function rowToReminder(r: ReminderRow): Reminder {
  return {
    id: r.id,
    ticketId: r.ticket_id ?? "",
    storeNumber: r.store_number ?? "",
    title: r.title ?? "",
    message: r.message ?? "",
    dueAt: r.due_at ?? undefined,
    status: decodeStatus(r.status),
    snoozeUntil: r.snooze_until ?? undefined,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
    dismissedAt: r.dismissed_at ?? undefined,
  };
}

/**
 * Idempotent ALTER for older databases that pre-date Phase 6. The Phase 1
 * schema only declared the eight base columns; we add `completed_at` and
 * `dismissed_at` lazily so no SCHEMA_VERSION bump is needed.
 */
async function ensureCompletedDismissedColumns(): Promise<void> {
  const db = await getDatabase();
  const cols = await db.select<{ name: string }[]>(
    `PRAGMA table_info(reminders)`,
  );
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("completed_at")) {
    await db.execute(`ALTER TABLE reminders ADD COLUMN completed_at TEXT`);
  }
  if (!have.has("dismissed_at")) {
    await db.execute(`ALTER TABLE reminders ADD COLUMN dismissed_at TEXT`);
  }
}

async function hydrateFromSqlite(): Promise<void> {
  await ensureCompletedDismissedColumns();
  const db = await getDatabase();
  const rows = await db.select<ReminderRow[]>(
    `SELECT id, ticket_id, store_number, title, message,
            due_at, status, snooze_until,
            created_at, completed_at, dismissed_at
       FROM reminders
       ORDER BY created_at DESC`,
  );
  cache.clear();
  for (const r of rows) cache.set(r.id, rowToReminder(r));
}

function readLocalStorage(): Reminder[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<Reminder> & Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];
    // Pre-Phase-6 reminders used `dueDate` / `relatedStoreNumber` / `relatedTicketId`.
    // Map those forward so a localStorage upgrade doesn't lose data.
    return parsed.map((legacy): Reminder => ({
      id: String(legacy.id ?? newId()),
      ticketId: String(legacy.ticketId ?? legacy.relatedTicketId ?? ""),
      storeNumber: String(legacy.storeNumber ?? legacy.relatedStoreNumber ?? ""),
      title: String(legacy.title ?? ""),
      message: String(legacy.message ?? ""),
      dueAt:
        typeof legacy.dueAt === "string"
          ? legacy.dueAt
          : typeof legacy.dueDate === "string"
            ? (legacy.dueDate as string)
            : undefined,
      status: decodeStatus(typeof legacy.status === "string" ? legacy.status : "open"),
      snoozeUntil: typeof legacy.snoozeUntil === "string" ? legacy.snoozeUntil : undefined,
      createdAt: String(legacy.createdAt ?? nowIso()),
      completedAt: typeof legacy.completedAt === "string" ? legacy.completedAt : undefined,
      dismissedAt: typeof legacy.dismissedAt === "string" ? legacy.dismissedAt : undefined,
    }));
  } catch {
    return [];
  }
}

function writeLocalStorage(items: Reminder[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

async function importLocalStorageIfNeeded(): Promise<void> {
  const legacy = readLocalStorage();
  if (legacy.length === 0) return;
  const db = await getDatabase();
  const existing = await db.select<{ id: string }[]>(`SELECT id FROM reminders`);
  const have = new Set(existing.map((r) => r.id));
  for (const r of legacy) {
    if (have.has(r.id)) continue;
    await sqliteUpsert(r);
    cache.set(r.id, r);
  }
}

async function sqliteUpsert(r: Reminder): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO reminders (
        id, ticket_id, store_number, title, message,
        due_at, status, snooze_until,
        created_at, completed_at, dismissed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT(id) DO UPDATE SET
        ticket_id = excluded.ticket_id,
        store_number = excluded.store_number,
        title = excluded.title,
        message = excluded.message,
        due_at = excluded.due_at,
        status = excluded.status,
        snooze_until = excluded.snooze_until,
        completed_at = excluded.completed_at,
        dismissed_at = excluded.dismissed_at`,
    [
      r.id,
      r.ticketId || null,
      r.storeNumber,
      r.title,
      r.message,
      r.dueAt ?? null,
      r.status,
      r.snoozeUntil ?? null,
      r.createdAt,
      r.completedAt ?? null,
      r.dismissedAt ?? null,
    ],
  );
}

async function sqliteDelete(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM reminders WHERE id = $1`, [id]);
}

export async function initRemindersStore(): Promise<void> {
  if (initialized) return;
  if (isTauriAvailable()) {
    try {
      await hydrateFromSqlite();
      await importLocalStorageIfNeeded();
      // Re-hydrate so newly-imported legacy rows show up in the cache.
      await hydrateFromSqlite();
      backend = "sqlite";
      initialized = true;
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[remindersStore] SQLite hydrate failed; falling back:", e);
    }
  }
  cache.clear();
  for (const r of readLocalStorage()) cache.set(r.id, r);
  backend = "localStorage";
  initialized = true;
}

/**
 * Resume any snoozed reminders whose snooze window has elapsed. Mutates the
 * cache + persists. Returns the IDs that were resumed so the caller can
 * surface a status message.
 */
function resumeExpiredSnoozes(now = Date.now()): string[] {
  const resumed: string[] = [];
  for (const r of cache.values()) {
    if (r.status !== "snoozed") continue;
    if (!r.snoozeUntil) continue;
    const t = Date.parse(r.snoozeUntil);
    if (!Number.isFinite(t)) continue;
    if (t > now) continue;
    const next: Reminder = { ...r, status: "open", snoozeUntil: undefined };
    cache.set(r.id, next);
    resumed.push(r.id);
    if (backend === "sqlite") {
      enqueue(`resume(${r.id})`, () => sqliteUpsert(next));
    }
  }
  if (resumed.length > 0 && backend === "localStorage") {
    writeLocalStorage([...cache.values()]);
  }
  return resumed;
}

function statusOrder(s: ReminderStatus): number {
  if (s === "open") return 0;
  if (s === "snoozed") return 1;
  if (s === "completed") return 2;
  return 3; // dismissed
}

function compareReminders(a: Reminder, b: Reminder): number {
  const orderDelta = statusOrder(a.status) - statusOrder(b.status);
  if (orderDelta !== 0) return orderDelta;
  // Within the same status, sort by due time ascending (no-due falls to the end).
  const da = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
  const db = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  // Tiebreak: oldest created first so old work doesn't get buried.
  return a.createdAt.localeCompare(b.createdAt);
}

export const remindersStore = {
  list(): Reminder[] {
    return [...cache.values()].sort(compareReminders);
  },

  get(id: string): Reminder | undefined {
    return cache.get(id);
  },

  /**
   * Reminders that should be surfaced *now* in the banner: status==="open"
   * and (no due time OR due in the past or within `withinMinutes` from now).
   * Snoozed reminders are excluded — they appear once the snooze elapses.
   */
  dueSoon(withinMinutes = 0): Reminder[] {
    const horizon = Date.now() + withinMinutes * 60 * 1000;
    return [...cache.values()].filter((r) => {
      if (r.status !== "open") return false;
      if (!r.dueAt) return false;
      const t = Date.parse(r.dueAt);
      return Number.isFinite(t) && t <= horizon;
    });
  },

  /**
   * Reminders for a single ticket, newest-first. Used by the Inspect tab and
   * the Overview reminder-count badges.
   */
  listByTicket(ticketId: string): Reminder[] {
    if (!ticketId) return [];
    return [...cache.values()]
      .filter((r) => r.ticketId === ticketId)
      .sort(compareReminders);
  },

  create(input: Partial<Reminder> & { title: string }): Reminder {
    const r: Reminder = {
      id: input.id ?? newId(),
      ticketId: input.ticketId ?? "",
      storeNumber: input.storeNumber ?? "",
      title: input.title,
      message: input.message ?? "",
      dueAt: input.dueAt,
      status: input.status ?? "open",
      snoozeUntil: input.snoozeUntil,
      createdAt: input.createdAt ?? nowIso(),
      completedAt: input.completedAt,
      dismissedAt: input.dismissedAt,
    };
    cache.set(r.id, r);
    if (backend === "sqlite") {
      enqueue(`create(${r.id})`, () => sqliteUpsert(r));
    } else {
      writeLocalStorage([...cache.values()]);
    }
    return r;
  },

  update(id: string, patch: Partial<Reminder>): Reminder | undefined {
    const existing = cache.get(id);
    if (!existing) return undefined;
    const next: Reminder = { ...existing, ...patch, id };
    cache.set(id, next);
    if (backend === "sqlite") {
      enqueue(`update(${id})`, () => sqliteUpsert(next));
    } else {
      writeLocalStorage([...cache.values()]);
    }
    return next;
  },

  setStatus(id: string, status: ReminderStatus, extra?: Partial<Reminder>): Reminder | undefined {
    const existing = cache.get(id);
    if (!existing) return undefined;
    const now = nowIso();
    const next: Reminder = {
      ...existing,
      ...extra,
      id,
      status,
      completedAt: status === "completed" ? now : existing.completedAt,
      dismissedAt: status === "dismissed" ? now : existing.dismissedAt,
      // Clear snoozeUntil when leaving the snoozed state — except when the
      // caller is *entering* snoozed and supplied a fresh snoozeUntil.
      snoozeUntil:
        status === "snoozed"
          ? extra?.snoozeUntil ?? existing.snoozeUntil
          : undefined,
    };
    cache.set(id, next);
    if (backend === "sqlite") {
      enqueue(`setStatus(${id})`, () => sqliteUpsert(next));
    } else {
      writeLocalStorage([...cache.values()]);
    }
    return next;
  },

  remove(id: string): void {
    if (!cache.has(id)) return;
    cache.delete(id);
    if (backend === "sqlite") {
      enqueue(`remove(${id})`, () => sqliteDelete(id));
    } else {
      writeLocalStorage([...cache.values()]);
    }
  },

  /**
   * Sweep snoozed reminders whose window has elapsed back to "open". Called
   * by the banner on a timer and by the Reminders page on render. Idempotent.
   */
  resumeExpiredSnoozes(): string[] {
    return resumeExpiredSnoozes();
  },
};
