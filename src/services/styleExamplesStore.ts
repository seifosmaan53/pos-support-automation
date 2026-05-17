/**
 * Phase 4: SQLite-backed style examples store.
 *
 * Migrated from localStorage. On first SQLite run, any examples already in
 * `localStorage[sta.styleExamples.v1]` are imported into the table once,
 * then the localStorage key is left in place (read-only) so a downgrade
 * doesn't lose data.
 *
 * `pickRelevant` now scores on the full ExtractedDetails — category, device,
 * result, and part-request type — instead of just transcript token overlap.
 * That matches the Phase 4 spec ("relevant means same category, same device,
 * similar issue, similar result, same part request type").
 */
import type { StyleExample } from "../types/styleExample";
import type { ExtractedDetails } from "../types/ticket";
import { newId, nowIso } from "../utils/formatDate";
import { getDatabase, isTauriAvailable } from "./sqliteClient";

const LS_KEY = "sta.styleExamples.v1";

interface StyleExampleRow {
  id: string;
  title: string;
  raw_input: string;
  ideal_subject: string;
  ideal_description: string;
  ideal_resolution: string;
  ideal_part_request: string;
  notes: string;
  created_at: string;
  /** Newer column added by migration. May be undefined for legacy rows. */
  updated_at?: string | null;
}

const cache = new Map<string, StyleExample>();
let backend: "sqlite" | "localStorage" | "uninitialized" = "uninitialized";
let initialized = false;
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(() => fn()).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[styleExamplesStore] ${label} failed:`, e);
  }) as Promise<T>;
  writeQueue = next;
  return next;
}

function rowToExample(r: StyleExampleRow): StyleExample {
  return {
    id: r.id,
    title: r.title,
    rawInput: r.raw_input ?? "",
    idealSubject: r.ideal_subject ?? "",
    idealDescription: r.ideal_description ?? "",
    idealResolution: r.ideal_resolution ?? "",
    idealPartRequest: r.ideal_part_request ?? "",
    notes: r.notes ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  };
}

async function ensureUpdatedAtColumn(): Promise<void> {
  const db = await getDatabase();
  const cols = await db.select<{ name: string }[]>(
    `PRAGMA table_info(style_examples)`,
  );
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("updated_at")) {
    await db.execute(
      `ALTER TABLE style_examples ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`,
    );
  }
}

async function hydrateFromSqlite(): Promise<void> {
  await ensureUpdatedAtColumn();
  const db = await getDatabase();
  const rows = await db.select<StyleExampleRow[]>(
    `SELECT id, title, raw_input, ideal_subject, ideal_description,
            ideal_resolution, ideal_part_request, notes,
            created_at, updated_at
       FROM style_examples
       ORDER BY created_at DESC`,
  );
  cache.clear();
  for (const r of rows) cache.set(r.id, rowToExample(r));
}

function readLocalStorage(): StyleExample[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StyleExample[];
  } catch {
    return [];
  }
}

function writeLocalStorage(items: StyleExample[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

async function importLocalStorageIfNeeded(): Promise<void> {
  const legacy = readLocalStorage();
  if (legacy.length === 0) return;
  // Skip already-imported rows by id. Idempotent — repeat boots are free.
  const db = await getDatabase();
  const existing = await db.select<{ id: string }[]>(
    `SELECT id FROM style_examples`,
  );
  const have = new Set(existing.map((r) => r.id));
  for (const ex of legacy) {
    if (have.has(ex.id)) continue;
    await sqliteUpsert({
      ...ex,
      updatedAt: ex.updatedAt || ex.createdAt,
    });
    cache.set(ex.id, ex);
  }
}

async function sqliteUpsert(ex: StyleExample): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO style_examples (
        id, title, raw_input, ideal_subject, ideal_description,
        ideal_resolution, ideal_part_request, notes,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        raw_input = excluded.raw_input,
        ideal_subject = excluded.ideal_subject,
        ideal_description = excluded.ideal_description,
        ideal_resolution = excluded.ideal_resolution,
        ideal_part_request = excluded.ideal_part_request,
        notes = excluded.notes,
        updated_at = excluded.updated_at`,
    [
      ex.id,
      ex.title,
      ex.rawInput,
      ex.idealSubject,
      ex.idealDescription,
      ex.idealResolution,
      ex.idealPartRequest,
      ex.notes,
      ex.createdAt,
      ex.updatedAt,
    ],
  );
}

export async function initStyleExamplesStore(): Promise<void> {
  if (initialized) return;
  if (isTauriAvailable()) {
    try {
      await hydrateFromSqlite();
      await importLocalStorageIfNeeded();
      // Re-hydrate so newly-imported rows show up in the cache.
      await hydrateFromSqlite();
      backend = "sqlite";
      initialized = true;
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[styleExamplesStore] SQLite hydrate failed; falling back:", e);
    }
  }
  cache.clear();
  for (const ex of readLocalStorage()) cache.set(ex.id, ex);
  backend = "localStorage";
  initialized = true;
}

function tokenize(s: string): Set<string> {
  const words = (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  return new Set(words);
}

interface RelevanceContext {
  category: string;
  deviceType: string;
  result: string;
  partKind: "needed" | "not-needed" | "unknown";
  issueTokens: Set<string>;
}

function buildContext(d: Pick<ExtractedDetails, "category" | "deviceType" | "result" | "issue" | "partNeeded" | "partRequest">): RelevanceContext {
  const partKind: RelevanceContext["partKind"] =
    d.partNeeded || (d.partRequest && d.partRequest.toLowerCase() !== "not needed")
      ? "needed"
      : d.partRequest && d.partRequest.toLowerCase() === "not needed"
        ? "not-needed"
        : "unknown";
  return {
    category: (d.category ?? "").toLowerCase(),
    deviceType: (d.deviceType ?? "").toLowerCase(),
    result: (d.result ?? "").toLowerCase(),
    partKind,
    issueTokens: tokenize(d.issue ?? ""),
  };
}

function scoreExample(ex: StyleExample, ctx: RelevanceContext): number {
  const haystack = `${ex.title} ${ex.rawInput} ${ex.idealSubject} ${ex.idealDescription} ${ex.idealResolution} ${ex.idealPartRequest}`.toLowerCase();
  let score = 0;
  // Category match — strongest signal. Worth 3 points.
  if (ctx.category && haystack.includes(ctx.category)) score += 3;
  // Device type match — 2 points.
  if (ctx.deviceType && haystack.includes(ctx.deviceType)) score += 2;
  // Result phrase match — 2 points (eg. "escalated", "resolved").
  if (ctx.result && haystack.includes(ctx.result)) score += 2;
  // Part-request kind — 1 point. Cheap signal but breaks ties.
  if (ctx.partKind === "not-needed" && /not needed/i.test(ex.idealPartRequest)) score += 1;
  if (ctx.partKind === "needed" && ex.idealPartRequest.trim().length > 0 && !/not needed/i.test(ex.idealPartRequest))
    score += 1;
  // Issue keyword overlap — adds up to 3 points.
  let overlap = 0;
  for (const t of ctx.issueTokens) {
    if (haystack.includes(t)) overlap++;
  }
  score += Math.min(overlap, 3);
  return score;
}

export const styleExamplesStore = {
  list(): StyleExample[] {
    return [...cache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  get(id: string): StyleExample | undefined {
    return cache.get(id);
  },

  upsert(input: Partial<StyleExample> & { id?: string }): StyleExample {
    const now = nowIso();
    const existing = input.id ? cache.get(input.id) : undefined;
    const merged: StyleExample = {
      id: existing?.id ?? input.id ?? newId(),
      title: input.title ?? existing?.title ?? "Untitled example",
      rawInput: input.rawInput ?? existing?.rawInput ?? "",
      idealSubject: input.idealSubject ?? existing?.idealSubject ?? "",
      idealDescription: input.idealDescription ?? existing?.idealDescription ?? "",
      idealResolution: input.idealResolution ?? existing?.idealResolution ?? "",
      idealPartRequest: input.idealPartRequest ?? existing?.idealPartRequest ?? "",
      notes: input.notes ?? existing?.notes ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    cache.set(merged.id, merged);
    if (backend === "sqlite") {
      enqueue(`upsert(${merged.id})`, () => sqliteUpsert(merged));
    } else {
      writeLocalStorage([...cache.values()]);
    }
    return merged;
  },

  remove(id: string): void {
    cache.delete(id);
    if (backend === "sqlite") {
      enqueue(`remove(${id})`, async () => {
        const db = await getDatabase();
        await db.execute(`DELETE FROM style_examples WHERE id = $1`, [id]);
      });
    } else {
      writeLocalStorage([...cache.values()]);
    }
  },

  /**
   * Pick up to N most relevant style examples for the given details.
   * Scoring weights: category 3, device 2, result 2, part-request kind 1,
   * up to 3 points of issue keyword overlap. Examples with score 0 are
   * dropped — better to send no examples than misleading ones.
   */
  pickRelevant(
    detailsOrTranscript:
      | Pick<ExtractedDetails, "category" | "deviceType" | "result" | "issue" | "partNeeded" | "partRequest">
      | string,
    max = 2,
  ): StyleExample[] {
    const all = [...cache.values()];
    if (all.length === 0) return [];
    if (typeof detailsOrTranscript === "string") {
      // Back-compat path — score by transcript token overlap only.
      const tokens = tokenize(detailsOrTranscript);
      if (tokens.size === 0) return all.slice(0, max);
      const scored = all
        .map((ex) => {
          const exTokens = tokenize(ex.rawInput);
          let overlap = 0;
          for (const t of exTokens) if (tokens.has(t)) overlap++;
          return { ex, score: overlap };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);
      return scored.slice(0, max).map((s) => s.ex);
    }
    const ctx = buildContext(detailsOrTranscript);
    const scored = all
      .map((ex) => ({ ex, score: scoreExample(ex, ctx) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, max).map((s) => s.ex);
  },
};
