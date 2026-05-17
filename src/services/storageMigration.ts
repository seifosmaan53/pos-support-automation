/**
 * localStorage → SQLite migration. Phase 1 only handles tickets; reminders,
 * style examples, knowledge items, and settings stay on localStorage until
 * Phase 3.
 *
 * Status states:
 *   - no_data:     nothing on localStorage to migrate (fresh install or
 *                  already cleaned up)
 *   - not_started: localStorage tickets exist and have not been migrated
 *   - migrated:    migration ran successfully (timestamped in `_meta`)
 *   - failed:      migration was attempted but errored; `error` is populated
 *
 * Safety guarantees:
 *   - The migration is idempotent (upsert-by-id), so re-running is safe.
 *   - localStorage is never auto-deleted. The user must click Delete Old
 *     after Verify Migration confirms parity.
 *   - Export Backup hands back JSON the user can save anywhere.
 */
import {
  __internal,
  flushPendingWrites,
  getStorageBackend,
  ticketStore,
} from "./databaseService";
import { isTauriAvailable, getMeta, setMeta } from "./sqliteClient";

export type MigrationStatusKind =
  | "no_data"
  | "not_started"
  | "migrated"
  | "failed";

export interface MigrationStatus {
  kind: MigrationStatusKind;
  /** Tickets currently sitting in localStorage. */
  localStorageCount: number;
  /** Tickets currently in the active backend (SQLite or localStorage). */
  backendCount: number;
  completedAt?: string;
  error?: string;
}

const META_STATUS_KEY = "tickets_migration_status";
const META_COMPLETED_AT_KEY = "tickets_migration_completed_at";
const META_ERROR_KEY = "tickets_migration_error";

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const localTickets = __internal.readLocalStorageTickets();
  const localCount = localTickets.length;
  const backendCount = ticketStore.count();

  if (!isTauriAvailable()) {
    // Without Tauri, the active backend IS localStorage — no migration
    // is meaningful. Surface this explicitly so the UI can disable buttons.
    return {
      kind: "no_data",
      localStorageCount: localCount,
      backendCount,
      error:
        "SQLite is only available inside the Tauri desktop app. Browser preview keeps using localStorage.",
    };
  }

  const recordedStatus = (await getMeta(META_STATUS_KEY).catch(() => null)) as
    | MigrationStatusKind
    | null;
  const completedAt = (await getMeta(META_COMPLETED_AT_KEY).catch(() => null)) ?? undefined;
  const error = (await getMeta(META_ERROR_KEY).catch(() => null)) ?? undefined;

  if (recordedStatus === "migrated") {
    return {
      kind: "migrated",
      localStorageCount: localCount,
      backendCount,
      completedAt,
    };
  }
  if (recordedStatus === "failed") {
    return {
      kind: "failed",
      localStorageCount: localCount,
      backendCount,
      error,
    };
  }
  if (localCount === 0) {
    return { kind: "no_data", localStorageCount: 0, backendCount };
  }
  return { kind: "not_started", localStorageCount: localCount, backendCount };
}

export interface MigrationResult {
  attempted: number;
  succeeded: number;
  errors: string[];
}

export async function runMigration(): Promise<MigrationResult> {
  if (!isTauriAvailable() || getStorageBackend() !== "sqlite") {
    throw new Error(
      "Migration is only available inside the Tauri desktop app with SQLite as the active backend.",
    );
  }
  const tickets = __internal.readLocalStorageTickets();
  const result: MigrationResult = {
    attempted: tickets.length,
    succeeded: 0,
    errors: [],
  };
  if (tickets.length === 0) {
    await setMeta(META_STATUS_KEY, "migrated");
    await setMeta(META_COMPLETED_AT_KEY, new Date().toISOString());
    await setMeta(META_ERROR_KEY, "");
    return result;
  }

  for (const t of tickets) {
    try {
      ticketStore.upsert(t);
      result.succeeded++;
    } catch (e) {
      result.errors.push(`${t.id}: ${(e as Error).message}`);
    }
  }
  // Wait for the in-flight queued writes to actually commit before stamping
  // the migration as completed. Without this, Verify could run before all
  // rows have hit SQLite.
  await flushPendingWrites();

  if (result.errors.length === 0) {
    await setMeta(META_STATUS_KEY, "migrated");
    await setMeta(META_COMPLETED_AT_KEY, new Date().toISOString());
    await setMeta(META_ERROR_KEY, "");
  } else {
    await setMeta(META_STATUS_KEY, "failed");
    await setMeta(META_ERROR_KEY, result.errors.join("\n"));
  }
  return result;
}

export interface VerifyResult {
  matches: boolean;
  localStorageCount: number;
  backendCount: number;
  missingIds: string[];
}

export async function verifyMigration(): Promise<VerifyResult> {
  await flushPendingWrites();
  const local = __internal.readLocalStorageTickets();
  const backend = ticketStore.list();
  const backendIds = new Set(backend.map((t) => t.id));
  const missingIds = local.map((t) => t.id).filter((id) => !backendIds.has(id));
  return {
    matches: missingIds.length === 0 && backend.length >= local.length,
    localStorageCount: local.length,
    backendCount: backend.length,
    missingIds,
  };
}

/**
 * Returns a JSON string the user can paste into a file. We intentionally do
 * not write the file ourselves — the user can copy the text, the History
 * page already exposes Export JSON, and any new file-saving path would need
 * its own permission scope.
 */
export function exportLocalStorageBackup(): string {
  const tickets = __internal.readLocalStorageTickets();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      source: "localStorage:" + __internal.ticketsLocalStorageKey,
      count: tickets.length,
      tickets,
    },
    null,
    2,
  );
}

/**
 * Wipes the legacy localStorage tickets blob. Callers MUST verify migration
 * first and confirm with the user before invoking this — once the data is
 * gone, the only fallback is a backup file the user saved.
 */
export function deleteLegacyLocalStorageTickets(): void {
  __internal.removeLocalStorageTickets();
}
