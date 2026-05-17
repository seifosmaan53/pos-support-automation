/**
 * Phase 7: SQLite-backed knowledge store.
 *
 * The Phase 1 schema already includes the `knowledge_items` table. This store
 * mirrors the `ticketFeedbackStore` / `remindersStore` pattern:
 *   • In-memory cache keyed by id → AnyKnowledgeItem.
 *   • A boot-time `initKnowledgeStore()` hydrates from SQLite if Tauri is
 *     available, otherwise from localStorage.
 *   • Writes update the cache synchronously and enqueue an async SQLite
 *     write through a serialized promise queue.
 *
 * Per-row content lives as JSON in `content_json`. The discriminator on
 * `type` lets us narrow the JSON shape on read; if a row's JSON is malformed,
 * we fall back to a default empty content rather than throwing — knowledge
 * is auxiliary data, never load-bearing.
 */
import {
  defaultContentForType,
  type AnyKnowledgeItem,
  type KnowledgeContentByType,
  type KnowledgeItem,
  type KnowledgeItemType,
} from "../types/knowledge";
import { newId, nowIso } from "../utils/formatDate";
import { getDatabase, isTauriAvailable } from "./sqliteClient";

const LS_KEY = "sta.knowledge.v1";

interface KnowledgeRow {
  id: string;
  type: string;
  title: string;
  content_json: string;
  created_at: string;
  updated_at: string;
}

const cache = new Map<string, AnyKnowledgeItem>();
let backend: "sqlite" | "localStorage" | "uninitialized" = "uninitialized";
let initialized = false;
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(() => fn()).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[knowledgeStore] ${label} failed:`, e);
  }) as Promise<T>;
  writeQueue = next;
  return next;
}

function isKnownType(t: string): t is KnowledgeItemType {
  return (
    t === "common_problem" ||
    t === "troubleshooting_guide" ||
    t === "part_request_rule" ||
    t === "escalation_rule" ||
    t === "store_note" ||
    t === "device_note" ||
    t === "category_mapping" ||
    t === "correction_rule"
  );
}

function rowToItem(r: KnowledgeRow): AnyKnowledgeItem | null {
  if (!isKnownType(r.type)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.content_json || "{}");
  } catch {
    parsed = {};
  }
  const fallback = defaultContentForType(r.type);
  // Shallow-merge parsed JSON over the per-type defaults so missing fields
  // don't crash downstream consumers (eg. an older row without `keywords`).
  const content = {
    ...fallback,
    ...(parsed && typeof parsed === "object" ? parsed : {}),
  };
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as AnyKnowledgeItem;
}

async function hydrateFromSqlite(): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<KnowledgeRow[]>(
    `SELECT id, type, title, content_json, created_at, updated_at
       FROM knowledge_items
       ORDER BY updated_at DESC`,
  );
  cache.clear();
  for (const r of rows) {
    const item = rowToItem(r);
    if (item) cache.set(item.id, item);
  }
}

function readLocalStorage(): AnyKnowledgeItem[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AnyKnowledgeItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((i) => i && isKnownType(i.type));
  } catch {
    return [];
  }
}

function writeLocalStorage(items: AnyKnowledgeItem[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

async function importLocalStorageIfNeeded(): Promise<void> {
  const legacy = readLocalStorage();
  if (legacy.length === 0) return;
  const db = await getDatabase();
  const existing = await db.select<{ id: string }[]>(
    `SELECT id FROM knowledge_items`,
  );
  const have = new Set(existing.map((r) => r.id));
  for (const item of legacy) {
    if (have.has(item.id)) continue;
    await sqliteUpsert(item);
    cache.set(item.id, item);
  }
}

async function sqliteUpsert(item: AnyKnowledgeItem): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO knowledge_items (id, type, title, content_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         title = excluded.title,
         content_json = excluded.content_json,
         updated_at = excluded.updated_at`,
    [
      item.id,
      item.type,
      item.title,
      JSON.stringify(item.content ?? {}),
      item.createdAt,
      item.updatedAt,
    ],
  );
}

async function sqliteDelete(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM knowledge_items WHERE id = $1`, [id]);
}

export async function initKnowledgeStore(): Promise<void> {
  if (initialized) return;
  if (isTauriAvailable()) {
    try {
      await hydrateFromSqlite();
      await importLocalStorageIfNeeded();
      // Re-hydrate so newly-imported localStorage rows show up in the cache.
      await hydrateFromSqlite();
      backend = "sqlite";
      initialized = true;
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[knowledgeStore] SQLite hydrate failed; falling back:", e);
    }
  }
  cache.clear();
  for (const item of readLocalStorage()) cache.set(item.id, item);
  backend = "localStorage";
  initialized = true;
}

function compareKnowledge(a: AnyKnowledgeItem, b: AnyKnowledgeItem): number {
  // Newest-updated first — matches "recently edited" expectations.
  return b.updatedAt.localeCompare(a.updatedAt);
}

export const knowledgeStore = {
  list(): AnyKnowledgeItem[] {
    return [...cache.values()].sort(compareKnowledge);
  },

  get(id: string): AnyKnowledgeItem | undefined {
    return cache.get(id);
  },

  listByType<T extends KnowledgeItemType>(type: T): KnowledgeItem<T>[] {
    // Cast through `unknown` because TS can't narrow a value's discriminator
    // back to a generic `T` even though the runtime check is exhaustive.
    return [...cache.values()]
      .filter((i) => i.type === type)
      .sort(compareKnowledge) as unknown as KnowledgeItem<T>[];
  },

  /**
   * Fuzzy text search across title and content. Returns case-insensitive
   * matches across the JSON-serialized content so the user can find an item
   * by typing a keyword without remembering which field it lives in.
   */
  search(query: string): AnyKnowledgeItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    return [...cache.values()]
      .filter((i) => {
        if (i.title.toLowerCase().includes(q)) return true;
        try {
          return JSON.stringify(i.content).toLowerCase().includes(q);
        } catch {
          return false;
        }
      })
      .sort(compareKnowledge);
  },

  create<T extends KnowledgeItemType>(input: {
    type: T;
    title: string;
    content?: Partial<KnowledgeContentByType[T]>;
  }): KnowledgeItem<T> {
    const id = newId();
    const now = nowIso();
    const merged = {
      ...defaultContentForType(input.type),
      ...(input.content ?? {}),
    } as KnowledgeContentByType[T];
    const item: KnowledgeItem<T> = {
      id,
      type: input.type,
      title: input.title,
      content: merged,
      createdAt: now,
      updatedAt: now,
    };
    cache.set(id, item as AnyKnowledgeItem);
    if (backend === "sqlite") {
      enqueue(`create(${id})`, () => sqliteUpsert(item as AnyKnowledgeItem));
    } else {
      writeLocalStorage([...cache.values()]);
    }
    return item;
  },

  update<T extends KnowledgeItemType>(
    id: string,
    patch: { title?: string; content?: Partial<KnowledgeContentByType[T]> },
  ): KnowledgeItem<T> | undefined {
    const existing = cache.get(id) as KnowledgeItem<T> | undefined;
    if (!existing) return undefined;
    const next: KnowledgeItem<T> = {
      ...existing,
      title: patch.title ?? existing.title,
      content: {
        ...existing.content,
        ...(patch.content ?? {}),
      } as KnowledgeContentByType[T],
      updatedAt: nowIso(),
    };
    cache.set(id, next as AnyKnowledgeItem);
    if (backend === "sqlite") {
      enqueue(`update(${id})`, () => sqliteUpsert(next as AnyKnowledgeItem));
    } else {
      writeLocalStorage([...cache.values()]);
    }
    return next;
  },

  /**
   * Replace the full record. Used when the editor saves the whole form at
   * once rather than a partial patch.
   */
  upsert(item: AnyKnowledgeItem): AnyKnowledgeItem {
    const next: AnyKnowledgeItem = { ...item, updatedAt: nowIso() };
    cache.set(next.id, next);
    if (backend === "sqlite") {
      enqueue(`upsert(${next.id})`, () => sqliteUpsert(next));
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
};
