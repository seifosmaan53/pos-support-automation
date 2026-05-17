/**
 * In-memory store for the SQLite `audio_files` table.
 *
 * Sync API mirrors `ticketStore` — reads return the cache instantly, writes
 * update the cache and queue an async SQLite write. Falls back to a
 * localStorage-backed cache when running in browser preview so the History
 * inspect view degrades gracefully.
 *
 * `initAudioFilesStore()` must complete before any consumer calls `list()`
 * or `getByTicket()`. It's awaited from `databaseService.initStorage()`.
 */
import type { AudioMetadata, TranscriptStatus } from "../types/audio";
import { getDatabase, isTauriAvailable } from "./sqliteClient";

const LS_KEY = "sta.audio_files.v1";

interface AudioRow {
  id: string;
  ticket_id: string | null;
  path: string;
  duration: number;
  format: string;
  created_at: string;
  deleted: number;
  transcript_status: string;
}

const cache = new Map<string, AudioMetadata>();
const byTicket = new Map<string, string>(); // ticketId → audioId

let backend: "sqlite" | "localStorage" | "uninitialized" = "uninitialized";
let initialized = false;
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(() => fn()).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[audioFilesStore] ${label} failed:`, e);
  }) as Promise<T>;
  writeQueue = next;
  return next;
}

function rowToMetadata(r: AudioRow): AudioMetadata {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    path: r.path,
    durationMs: r.duration | 0,
    format: r.format || "wav",
    createdAt: r.created_at,
    deleted: !!r.deleted,
    transcriptStatus: (r.transcript_status as TranscriptStatus) || "",
  };
}

function indexInCache(m: AudioMetadata): void {
  cache.set(m.id, m);
  if (m.ticketId && !m.deleted) {
    byTicket.set(m.ticketId, m.id);
  }
}

async function hydrateFromSqlite(): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<AudioRow[]>(
    `SELECT id, ticket_id, path, duration, format, created_at, deleted, transcript_status
       FROM audio_files
       ORDER BY created_at DESC`,
  );
  cache.clear();
  byTicket.clear();
  for (const r of rows) {
    indexInCache(rowToMetadata(r));
  }
}

function hydrateFromLocalStorage(): void {
  cache.clear();
  byTicket.clear();
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as AudioMetadata[];
    for (const m of list) indexInCache(m);
  } catch {
    // ignore — empty cache is a valid initial state
  }
}

function persistAllToLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify([...cache.values()]));
}

async function sqliteUpsert(m: AudioMetadata): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO audio_files (
        id, ticket_id, path, duration, format,
        created_at, deleted, transcript_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT(id) DO UPDATE SET
        ticket_id = excluded.ticket_id,
        path = excluded.path,
        duration = excluded.duration,
        format = excluded.format,
        deleted = excluded.deleted,
        transcript_status = excluded.transcript_status`,
    [
      m.id,
      m.ticketId,
      m.path,
      m.durationMs | 0,
      m.format,
      m.createdAt,
      m.deleted ? 1 : 0,
      m.transcriptStatus,
    ],
  );
}

export async function initAudioFilesStore(): Promise<void> {
  if (initialized) return;
  if (isTauriAvailable()) {
    try {
      await hydrateFromSqlite();
      backend = "sqlite";
      initialized = true;
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[audioFilesStore] SQLite hydrate failed; falling back:", e);
    }
  }
  hydrateFromLocalStorage();
  backend = "localStorage";
  initialized = true;
}

export const audioFilesStore = {
  list(): AudioMetadata[] {
    return [...cache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  get(id: string): AudioMetadata | undefined {
    return cache.get(id);
  },

  /**
   * Returns the most recent non-deleted audio file linked to a ticket.
   * Used by History badges and the Inspect Audio tab to find playable audio
   * without re-querying SQLite each render.
   */
  getByTicket(ticketId: string): AudioMetadata | undefined {
    const id = byTicket.get(ticketId);
    if (!id) return undefined;
    return cache.get(id);
  },

  upsert(m: AudioMetadata): void {
    indexInCache(m);
    if (backend === "sqlite") {
      enqueue(`upsert(${m.id})`, () => sqliteUpsert(m));
    } else {
      persistAllToLocalStorage();
    }
  },

  /**
   * Soft-delete: flips `deleted = true` and clears the ticket→audio index
   * but keeps the row so History can still show "Audio deleted" and so we
   * keep a record that audio existed at some point. The actual file on disk
   * is removed by the caller (via `deleteAudioFile()` from audioStorage).
   */
  markDeleted(id: string): AudioMetadata | undefined {
    const existing = cache.get(id);
    if (!existing) return undefined;
    if (existing.deleted) return existing;
    const updated: AudioMetadata = { ...existing, deleted: true };
    cache.set(id, updated);
    if (existing.ticketId) {
      const indexed = byTicket.get(existing.ticketId);
      if (indexed === id) byTicket.delete(existing.ticketId);
    }
    if (backend === "sqlite") {
      enqueue(`markDeleted(${id})`, () => sqliteUpsert(updated));
    } else {
      persistAllToLocalStorage();
    }
    return updated;
  },

  setTranscriptStatus(id: string, status: TranscriptStatus): void {
    const existing = cache.get(id);
    if (!existing) return;
    const updated: AudioMetadata = { ...existing, transcriptStatus: status };
    cache.set(id, updated);
    if (existing.ticketId && !existing.deleted) byTicket.set(existing.ticketId, id);
    if (backend === "sqlite") {
      enqueue(`setStatus(${id})`, () => sqliteUpsert(updated));
    } else {
      persistAllToLocalStorage();
    }
  },
};
