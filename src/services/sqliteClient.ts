/**
 * Tauri SQLite client wrapper.
 *
 * The plugin only works inside the Tauri webview — Vite dev mode in a plain
 * browser tab has no access to it. `isTauriAvailable()` lets the rest of the
 * app fall back to localStorage cleanly when SQLite is unavailable, so the
 * dev workflow doesn't break.
 *
 * The plugin exposes `Database.load(path)` which is async; we cache the
 * resolved instance here so repeated callers share one connection pool.
 */
import type Database from "@tauri-apps/plugin-sql";
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "./sqliteSchema";

const DB_PATH = "sqlite:store-ticket-assistant.db";

let dbPromise: Promise<Database> | null = null;

export function isTauriAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Lazily load the SQLite plugin module and open the DB. Importing the plugin
 * statically would crash a non-Tauri Vite dev tab on first paint — the plugin
 * tries to invoke a Tauri command at import time.
 */
async function loadDatabase(): Promise<Database> {
  if (!isTauriAvailable()) {
    throw new Error(
      "SQLite is unavailable: not running inside the Tauri webview. " +
        "The desktop app uses SQLite; browser preview falls back to localStorage.",
    );
  }
  const mod = await import("@tauri-apps/plugin-sql");
  return mod.default.load(DB_PATH);
}

export async function getDatabase(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = loadDatabase().catch((e) => {
      // Allow a later retry if the first open failed.
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/**
 * Apply every DDL statement in `SCHEMA_STATEMENTS` and stamp `_meta` with the
 * current schema version. Idempotent — safe to call on every boot.
 */
export async function applySchema(): Promise<void> {
  const db = await getDatabase();
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.execute(stmt);
  }
  await db.execute(
    `INSERT INTO _meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ["schema_version", String(SCHEMA_VERSION)],
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDatabase();
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM _meta WHERE key = $1`,
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO _meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function deleteMeta(key: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM _meta WHERE key = $1`, [key]);
}
