/**
 * Phase 10B+C: localStorage-backed pattern store.
 *
 * Mirrors the cache + serialized-write pattern of the SQLite-backed stores
 * (knowledgeStore, remindersStore) but keeps things in localStorage for v1
 * to avoid a schema migration on every install. SQLite-backing can be added
 * later by swapping the load/persist functions; the public API stays stable.
 */
import { newId, nowIso } from "../utils/formatDate";
import type {
  ExtractionPattern,
  ExtractionPatternKind,
} from "../types/extractionPattern";

const STORAGE_KEY = "sta:extraction-patterns";

const cache: Map<string, ExtractionPattern> = new Map();
let hydrated = false;

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — best-effort.
  }
}

function hydrate(): void {
  if (hydrated) return;
  const stored = readJson<ExtractionPattern[]>(STORAGE_KEY, []);
  cache.clear();
  for (const p of stored) {
    if (p && typeof p.id === "string") cache.set(p.id, p);
  }
  hydrated = true;
}

function persist(): void {
  writeJson(STORAGE_KEY, [...cache.values()]);
}

function compare(a: ExtractionPattern, b: ExtractionPattern): number {
  // Manual patterns ranked above learned (assumed more deliberate).
  if (a.source !== b.source) return a.source === "manual" ? -1 : 1;
  // Within source, most-recently-used first so frequently-useful patterns rise.
  const aAt = a.lastUsedAt ?? a.createdAt;
  const bAt = b.lastUsedAt ?? b.createdAt;
  return bAt.localeCompare(aAt);
}

export const extractionPatternsStore = {
  list(): ExtractionPattern[] {
    hydrate();
    return [...cache.values()].sort(compare);
  },

  listByKind(kind: ExtractionPatternKind): ExtractionPattern[] {
    return this.list().filter((p) => p.kind === kind);
  },

  /** Active = enabled patterns of any kind, sorted by store priority. */
  active(): ExtractionPattern[] {
    return this.list().filter((p) => p.enabled);
  },

  get(id: string): ExtractionPattern | null {
    hydrate();
    return cache.get(id) ?? null;
  },

  create(input: {
    kind: ExtractionPatternKind;
    label: string;
    pattern: string;
    flags?: string;
    captureGroup?: number;
    enabled?: boolean;
    source?: "manual" | "learned";
    example?: string;
  }): ExtractionPattern {
    hydrate();
    const item: ExtractionPattern = {
      id: newId(),
      kind: input.kind,
      label: input.label.trim() || `${input.kind} pattern`,
      pattern: input.pattern,
      flags: input.flags ?? "i",
      captureGroup: input.captureGroup ?? 1,
      enabled: input.enabled ?? true,
      source: input.source ?? "manual",
      example: input.example,
      createdAt: nowIso(),
      useCount: 0,
    };
    cache.set(item.id, item);
    persist();
    return item;
  },

  update(id: string, patch: Partial<Omit<ExtractionPattern, "id" | "createdAt">>): ExtractionPattern | null {
    hydrate();
    const existing = cache.get(id);
    if (!existing) return null;
    const next: ExtractionPattern = { ...existing, ...patch };
    cache.set(id, next);
    persist();
    return next;
  },

  remove(id: string): boolean {
    hydrate();
    const removed = cache.delete(id);
    if (removed) persist();
    return removed;
  },

  /**
   * Increment use count + bump lastUsedAt. Called by analyzeTranscript when
   * a pattern produces a hit, so the Settings list can show "used 7×, last
   * 2 hours ago" — a meaningful signal of which patterns are pulling weight.
   */
  recordHit(id: string): void {
    hydrate();
    const p = cache.get(id);
    if (!p) return;
    cache.set(id, { ...p, useCount: p.useCount + 1, lastUsedAt: nowIso() });
    // Defer persist to avoid hammering localStorage during a long analysis;
    // the next create/update/remove will flush.
    queueMicrotask(persist);
  },

  /**
   * Idempotent learn: if a learned pattern with the same (kind, pattern)
   * already exists, bump its useCount and don't create a duplicate. This
   * prevents the bank from bloating with identical patterns when the user
   * answers the same kind across many calls with the same surrounding phrasing.
   */
  upsertLearned(input: {
    kind: ExtractionPatternKind;
    label: string;
    pattern: string;
    flags?: string;
    captureGroup?: number;
    example?: string;
  }): ExtractionPattern {
    hydrate();
    const existing = [...cache.values()].find(
      (p) =>
        p.source === "learned" &&
        p.kind === input.kind &&
        p.pattern === input.pattern &&
        p.flags === (input.flags ?? "i"),
    );
    if (existing) {
      const updated = {
        ...existing,
        useCount: existing.useCount + 1,
        lastUsedAt: nowIso(),
      };
      cache.set(existing.id, updated);
      persist();
      return updated;
    }
    return this.create({ ...input, source: "learned" });
  },
};
