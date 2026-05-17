/**
 * Phase 4: SQLite-backed feedback store.
 *
 * Holds the `ticket_feedback` rows in an in-memory cache so History/Inspect
 * can render synchronously. Writes go through the same enqueue pattern as
 * `audioFilesStore` so concurrent saves don't race.
 *
 * Falls back to localStorage when running outside the Tauri webview so the
 * dev workflow keeps working — same pattern Phase 1 established for tickets.
 */
import type {
  FieldCorrection,
  ResolutionStatus,
  TicketFeedback,
} from "../types/feedback";
import { newId, nowIso } from "../utils/formatDate";
import { getDatabase, isTauriAvailable } from "./sqliteClient";

const LS_KEY = "sta.ticketFeedback.v1";

interface FeedbackRow {
  id: string;
  ticket_id: string;
  original_subject: string;
  corrected_subject: string;
  original_description: string;
  corrected_description: string;
  original_resolution: string;
  corrected_resolution: string;
  corrected_fields_json: string;
  what_ai_missed: string;
  resolution_worked: number | null;
  style_example_id: string | null;
  created_at: string;
}

const cache = new Map<string, TicketFeedback>();
const byTicket = new Map<string, string[]>(); // ticketId → feedback ids

let backend: "sqlite" | "localStorage" | "uninitialized" = "uninitialized";
let initialized = false;
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(() => fn()).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[ticketFeedbackStore] ${label} failed:`, e);
  }) as Promise<T>;
  writeQueue = next;
  return next;
}

function decodeResolution(v: number | null): ResolutionStatus {
  if (v === 1) return "worked";
  if (v === 0) return "did-not-work";
  return "unknown";
}

function encodeResolution(s: ResolutionStatus): number | null {
  if (s === "worked") return 1;
  if (s === "did-not-work") return 0;
  return null;
}

function rowToFeedback(r: FeedbackRow): TicketFeedback {
  let correctedFields: FieldCorrection[] = [];
  try {
    const parsed = JSON.parse(r.corrected_fields_json || "[]");
    if (Array.isArray(parsed)) correctedFields = parsed as FieldCorrection[];
  } catch {
    /* keep empty */
  }
  return {
    id: r.id,
    ticketId: r.ticket_id,
    originalSubject: r.original_subject ?? "",
    correctedSubject: r.corrected_subject ?? "",
    originalDescription: r.original_description ?? "",
    correctedDescription: r.corrected_description ?? "",
    originalResolution: r.original_resolution ?? "",
    correctedResolution: r.corrected_resolution ?? "",
    correctedFields,
    whatAiMissed: r.what_ai_missed ?? "",
    resolutionWorked: decodeResolution(r.resolution_worked),
    styleExampleId: r.style_example_id ?? null,
    createdAt: r.created_at,
  };
}

function indexInCache(f: TicketFeedback): void {
  cache.set(f.id, f);
  const list = byTicket.get(f.ticketId) ?? [];
  if (!list.includes(f.id)) {
    list.push(f.id);
    byTicket.set(f.ticketId, list);
  }
}

async function hydrateFromSqlite(): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<FeedbackRow[]>(
    `SELECT id, ticket_id,
            original_subject, corrected_subject,
            original_description, corrected_description,
            original_resolution, corrected_resolution,
            corrected_fields_json, what_ai_missed,
            resolution_worked, style_example_id, created_at
       FROM ticket_feedback
       ORDER BY created_at DESC`,
  );
  cache.clear();
  byTicket.clear();
  for (const r of rows) indexInCache(rowToFeedback(r));
}

function hydrateFromLocalStorage(): void {
  cache.clear();
  byTicket.clear();
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as TicketFeedback[];
    for (const f of list) indexInCache(f);
  } catch {
    /* ignore */
  }
}

function persistAllToLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify([...cache.values()]));
}

async function sqliteUpsert(f: TicketFeedback): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO ticket_feedback (
        id, ticket_id,
        original_subject, corrected_subject,
        original_description, corrected_description,
        original_resolution, corrected_resolution,
        corrected_fields_json, what_ai_missed,
        resolution_worked, style_example_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT(id) DO UPDATE SET
        original_subject = excluded.original_subject,
        corrected_subject = excluded.corrected_subject,
        original_description = excluded.original_description,
        corrected_description = excluded.corrected_description,
        original_resolution = excluded.original_resolution,
        corrected_resolution = excluded.corrected_resolution,
        corrected_fields_json = excluded.corrected_fields_json,
        what_ai_missed = excluded.what_ai_missed,
        resolution_worked = excluded.resolution_worked,
        style_example_id = excluded.style_example_id`,
    [
      f.id,
      f.ticketId,
      f.originalSubject,
      f.correctedSubject,
      f.originalDescription,
      f.correctedDescription,
      f.originalResolution,
      f.correctedResolution,
      JSON.stringify(f.correctedFields ?? []),
      f.whatAiMissed,
      encodeResolution(f.resolutionWorked),
      f.styleExampleId ?? null,
      f.createdAt,
    ],
  );
}

export async function initTicketFeedbackStore(): Promise<void> {
  if (initialized) return;
  if (isTauriAvailable()) {
    try {
      await hydrateFromSqlite();
      backend = "sqlite";
      initialized = true;
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ticketFeedbackStore] SQLite hydrate failed; falling back:", e);
    }
  }
  hydrateFromLocalStorage();
  backend = "localStorage";
  initialized = true;
}

export const ticketFeedbackStore = {
  list(): TicketFeedback[] {
    return [...cache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  get(id: string): TicketFeedback | undefined {
    return cache.get(id);
  },

  /**
   * All feedback rows for a ticket, newest first. Multiple rows are allowed
   * — each major correction round (eg. "tweak description today, mark
   * resolution worked next week") is recorded separately so the audit trail
   * stays linear.
   */
  listByTicket(ticketId: string): TicketFeedback[] {
    const ids = byTicket.get(ticketId) ?? [];
    return ids
      .map((id) => cache.get(id))
      .filter((f): f is TicketFeedback => !!f)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /**
   * Latest feedback row for a ticket (or undefined). Used by the toolbar to
   * pre-fill resolution status and AI-missed notes when the user opens the
   * form again.
   */
  latestForTicket(ticketId: string): TicketFeedback | undefined {
    return this.listByTicket(ticketId)[0];
  },

  upsert(input: Partial<TicketFeedback> & { ticketId: string }): TicketFeedback {
    const existing = input.id ? cache.get(input.id) : undefined;
    const merged: TicketFeedback = {
      id: existing?.id ?? input.id ?? newId(),
      ticketId: input.ticketId,
      originalSubject: input.originalSubject ?? existing?.originalSubject ?? "",
      correctedSubject: input.correctedSubject ?? existing?.correctedSubject ?? "",
      originalDescription: input.originalDescription ?? existing?.originalDescription ?? "",
      correctedDescription: input.correctedDescription ?? existing?.correctedDescription ?? "",
      originalResolution: input.originalResolution ?? existing?.originalResolution ?? "",
      correctedResolution: input.correctedResolution ?? existing?.correctedResolution ?? "",
      correctedFields: input.correctedFields ?? existing?.correctedFields ?? [],
      whatAiMissed: input.whatAiMissed ?? existing?.whatAiMissed ?? "",
      resolutionWorked: input.resolutionWorked ?? existing?.resolutionWorked ?? "unknown",
      styleExampleId: input.styleExampleId ?? existing?.styleExampleId ?? null,
      createdAt: existing?.createdAt ?? input.createdAt ?? nowIso(),
    };
    indexInCache(merged);
    if (backend === "sqlite") {
      enqueue(`upsert(${merged.id})`, () => sqliteUpsert(merged));
    } else {
      persistAllToLocalStorage();
    }
    return merged;
  },

  remove(id: string): void {
    const existing = cache.get(id);
    if (!existing) return;
    cache.delete(id);
    const list = byTicket.get(existing.ticketId);
    if (list) {
      const idx = list.indexOf(id);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) byTicket.delete(existing.ticketId);
    }
    if (backend === "sqlite") {
      enqueue(`remove(${id})`, async () => {
        const db = await getDatabase();
        await db.execute(`DELETE FROM ticket_feedback WHERE id = $1`, [id]);
      });
    } else {
      persistAllToLocalStorage();
    }
  },
};
