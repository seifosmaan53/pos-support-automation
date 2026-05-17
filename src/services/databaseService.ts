/**
 * Storage layer for tickets and settings.
 *
 * Public API (`ticketStore`, `settingsStore`) is intentionally synchronous —
 * the rest of the app already calls `ticketStore.list()` from useMemo and
 * `ticketStore.upsert()` from sync event handlers. Making those calls async
 * would cascade through every page and the entire `appStore.ts`.
 *
 * Strategy: hold all tickets in an in-memory cache. Reads return the cache
 * synchronously. Writes update the cache synchronously and dispatch an async
 * write through a serialized promise queue. The actual durable target is
 * SQLite when running inside the Tauri webview, and localStorage when running
 * in plain Vite dev (browser preview, unit-test runners).
 *
 * Boot path: `initStorage()` is called once from `main.tsx` before
 * `ReactDOM.render`. It detects Tauri, opens SQLite, applies the schema, and
 * hydrates the cache. If SQLite is unreachable for any reason it falls back
 * to localStorage so the app never boots into a blank History page.
 */
import {
  EMPTY_DETAILS,
  EMPTY_EVIDENCE,
  EMPTY_SUMMARIES,
  EMPTY_TICKET_FIELDS,
  type DetailLevel,
  type ExtractedDetails,
  type SavedCorrectionChange,
  type SavedNameCorrection,
  type SavedSpeakerSegment,
  type SavedTicket,
  type SummarySet,
  type TicketFields,
} from "../types/ticket";
import type { AppSettings } from "../types/settings";
import { DEFAULT_SETTINGS } from "../types/settings";
import {
  applySchema,
  getDatabase,
  isTauriAvailable,
} from "./sqliteClient";
import { createSerializedWriteQueue } from "../utils/serializedWriteQueue";
import { initAudioFilesStore } from "./audioFilesStore";
import { initTicketFeedbackStore } from "./ticketFeedbackStore";
import { initStyleExamplesStore } from "./styleExamplesStore";
import { initRemindersStore } from "./remindersStore";
import { initKnowledgeStore } from "./knowledgeStore";

const TICKETS_KEY = "sta.tickets.v1";
const SETTINGS_KEY = "sta.settings.v1";

// ───────────────────────────────────────────────────────────────────────────
// Boundary normalization (preserved from the legacy localStorage path)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Normalize a saved ticket on read. Older tickets pre-date newer fields
 * (servicesRestarted, devices, wrongCaller, transferDepartment) and the
 * stored JSON literally lacks those keys. Without this merge, any consumer
 * that calls `.includes`, `.length`, or `for-of` on a missing array throws
 * "undefined is not an object". We harden the data at the boundary so
 * downstream code (Intelligence, History, loadTicket) can trust the shape.
 */
function normalizeTicket(t: SavedTicket): SavedTicket {
  const details: ExtractedDetails = {
    ...EMPTY_DETAILS,
    ...(t.details ?? {}),
    evidence: { ...EMPTY_EVIDENCE, ...(t.details?.evidence ?? {}) },
    affectedRegisters: arr(t.details?.affectedRegisters),
    symptoms: arr(t.details?.symptoms),
    steps: arr(t.details?.steps),
    servicesRestarted: arr(t.details?.servicesRestarted),
    parts: arr(t.details?.parts),
    devices: arr(t.details?.devices),
    systems: arr(t.details?.systems),
    confidenceNotes: arr(t.details?.confidenceNotes),
    missingInfo: arr(t.details?.missingInfo),
    suggestedQuestions: arr(t.details?.suggestedQuestions),
  };
  const ticketFields: TicketFields = {
    ...EMPTY_TICKET_FIELDS,
    ...(t.ticketFields ?? {}),
    missingInfoWarnings: arr(t.ticketFields?.missingInfoWarnings),
    capturedNotices: arr(t.ticketFields?.capturedNotices),
    suggestedQuestions: arr(t.ticketFields?.suggestedQuestions),
  };
  const summaries: SummarySet = {
    ...EMPTY_SUMMARIES,
    ...(t.summaries ?? {}),
  };
  return {
    ...t,
    details,
    ticketFields,
    summaries,
    transcript: t.transcript ?? t.rawTranscript ?? "",
    rawTranscript: t.rawTranscript ?? t.transcript ?? "",
    correctedTranscript: t.correctedTranscript ?? t.transcript ?? "",
    speakerSegments: arr(t.speakerSegments),
    userCorrectedSpeakerSegments: arr(t.userCorrectedSpeakerSegments),
    correctionChanges: arr(t.correctionChanges),
    approvedCorrections: arr(t.approvedCorrections),
    undoneCorrections: arr(t.undoneCorrections),
    nameCorrectionsApplied: arr(t.nameCorrectionsApplied),
    extractionSourceVersion: t.extractionSourceVersion ?? "legacy",
    extractionTimestamp: t.extractionTimestamp ?? t.createdAt ?? "",
    audioId: t.audioId ?? null,
    transcriptVersions: arr(t.transcriptVersions),
    copyLog: arr(t.copyLog),
    copySequenceCompleted: !!t.copySequenceCompleted,
  };
}

function arr<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

// ───────────────────────────────────────────────────────────────────────────
// localStorage helpers (used as fallback backend AND the migration source)
// ───────────────────────────────────────────────────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "Error";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
      throw new Error(
        "Local storage is full. Delete some tickets in History or clear all tickets in Settings.",
      );
    }
    throw e;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Cache + write queue
// ───────────────────────────────────────────────────────────────────────────

export type StorageBackend = "sqlite" | "localStorage" | "uninitialized";

interface RecentError {
  at: string;
  op: string;
  message: string;
}

const cache = new Map<string, SavedTicket>();
let backend: StorageBackend = "uninitialized";
let initialized = false;
let initPromise: Promise<void> | null = null;
const sqliteTicketWriteQueue = createSerializedWriteQueue();
const recentErrors: RecentError[] = [];

/** Dispatched when a queued SQLite write fails (detail: `{ op, message }`). */
export const STORAGE_WRITE_FAILED_EVENT = "sta-storage-write-failed";

function dispatchWriteFailed(op: string, message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(STORAGE_WRITE_FAILED_EVENT, {
      detail: { op, message },
    }),
  );
}

function recordError(op: string, e: unknown): void {
  const message = (e as Error)?.message ?? String(e);
  recentErrors.unshift({ at: new Date().toISOString(), op, message });
  if (recentErrors.length > 20) recentErrors.length = 20;
  // eslint-disable-next-line no-console
  console.error(`[storage] ${op} failed:`, e);
}

/** Serialize an async write so concurrent upserts don't race in SQLite. */
function enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return sqliteTicketWriteQueue.enqueue(fn, (e) => {
    recordError(label, e);
    dispatchWriteFailed(label, (e as Error)?.message ?? String(e));
  });
}

// ───────────────────────────────────────────────────────────────────────────
// SQLite serialization (write SavedTicket → rows)
// ───────────────────────────────────────────────────────────────────────────

function bool(v: unknown): number {
  return v ? 1 : 0;
}

/**
 * Idempotent ALTER TABLE migration for v1 → v2: adds `transcript_versions_json`
 * to existing tickets tables. New installs already get the column from
 * `SCHEMA_STATEMENTS` and this no-ops because the PRAGMA reports it present.
 */
async function migrateAddTranscriptVersionsColumn(): Promise<void> {
  const db = await getDatabase();
  const cols = await db.select<{ name: string }[]>(
    `PRAGMA table_info(tickets)`,
  );
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("transcript_versions_json")) {
    await db.execute(
      `ALTER TABLE tickets ADD COLUMN transcript_versions_json TEXT NOT NULL DEFAULT '[]'`,
    );
  }
}

/**
 * Phase 9: idempotent ALTER for `tickets` to add `copy_log_json` and
 * `copy_sequence_completed` columns. Same PRAGMA pattern as the v2→v3
 * migrations so re-runs are free, and the SCHEMA_VERSION doesn't have to
 * bump for what is purely user-facing telemetry.
 */
async function migrateAddCopyLogColumns(): Promise<void> {
  const db = await getDatabase();
  const cols = await db.select<{ name: string }[]>(
    `PRAGMA table_info(tickets)`,
  );
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("copy_log_json")) {
    await db.execute(
      `ALTER TABLE tickets ADD COLUMN copy_log_json TEXT NOT NULL DEFAULT '[]'`,
    );
  }
  if (!have.has("copy_sequence_completed")) {
    await db.execute(
      `ALTER TABLE tickets ADD COLUMN copy_sequence_completed INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

/**
 * Idempotent v2 → v3 migration for `ticket_feedback`: adds `original_*`
 * snapshot columns and `style_example_id` foreign-key column. Runs once
 * per upgrade — the PRAGMA check makes re-runs free.
 */
async function migrateAddFeedbackOriginalColumns(): Promise<void> {
  const db = await getDatabase();
  const cols = await db.select<{ name: string }[]>(
    `PRAGMA table_info(ticket_feedback)`,
  );
  const have = new Set(cols.map((c) => c.name));
  const adds: [string, string][] = [
    ["original_subject", `ALTER TABLE ticket_feedback ADD COLUMN original_subject TEXT NOT NULL DEFAULT ''`],
    ["original_description", `ALTER TABLE ticket_feedback ADD COLUMN original_description TEXT NOT NULL DEFAULT ''`],
    ["original_resolution", `ALTER TABLE ticket_feedback ADD COLUMN original_resolution TEXT NOT NULL DEFAULT ''`],
    ["style_example_id", `ALTER TABLE ticket_feedback ADD COLUMN style_example_id TEXT`],
  ];
  for (const [col, sql] of adds) {
    if (!have.has(col)) await db.execute(sql);
  }
}

async function sqliteWriteTicket(t: SavedTicket): Promise<void> {
  const db = await getDatabase();
  // No SQL-level BEGIN/COMMIT here. tauri-plugin-sql wraps an sqlx pool, and
  // each `db.execute()` may grab a different connection — so a multi-call
  // transaction can deadlock against itself (BEGIN on conn A, INSERT on
  // conn B waiting for A's write lock). Since writeQueue already serializes
  // writes in-process, each statement running as its own implicit transaction
  // gives the same effective ordering without the deadlock risk.
  await db.execute(
      `INSERT INTO tickets (
        id, created_at, updated_at,
        raw_transcript, corrected_transcript,
        summaries_json, extracted_json, ticket_fields_json,
        store_number, register_number, caller_name, caller_role,
        subject, description, resolution, additional_comments,
        category, sub_category, item, transaction_number, item_number,
        type_of_transaction, payment_type,
        result, part_needed, part_request,
        audio_id, reviewed, copied,
        extraction_source_version, extraction_timestamp,
        detail_level, generated_ticket, notes,
        transcript_versions_json,
        copy_log_json, copy_sequence_completed
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20, $21,
        $22, $23,
        $24, $25, $26,
        $27, $28, $29,
        $30, $31,
        $32, $33, $34,
        $35,
        $36, $37
      )
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        raw_transcript = excluded.raw_transcript,
        corrected_transcript = excluded.corrected_transcript,
        summaries_json = excluded.summaries_json,
        extracted_json = excluded.extracted_json,
        ticket_fields_json = excluded.ticket_fields_json,
        store_number = excluded.store_number,
        register_number = excluded.register_number,
        caller_name = excluded.caller_name,
        caller_role = excluded.caller_role,
        subject = excluded.subject,
        description = excluded.description,
        resolution = excluded.resolution,
        additional_comments = excluded.additional_comments,
        category = excluded.category,
        sub_category = excluded.sub_category,
        item = excluded.item,
        transaction_number = excluded.transaction_number,
        item_number = excluded.item_number,
        type_of_transaction = excluded.type_of_transaction,
        payment_type = excluded.payment_type,
        result = excluded.result,
        part_needed = excluded.part_needed,
        part_request = excluded.part_request,
        audio_id = excluded.audio_id,
        reviewed = excluded.reviewed,
        copied = excluded.copied,
        extraction_source_version = excluded.extraction_source_version,
        extraction_timestamp = excluded.extraction_timestamp,
        detail_level = excluded.detail_level,
        generated_ticket = excluded.generated_ticket,
        notes = excluded.notes,
        transcript_versions_json = excluded.transcript_versions_json,
        copy_log_json = excluded.copy_log_json,
        copy_sequence_completed = excluded.copy_sequence_completed`,
      [
        t.id,
        t.createdAt,
        t.updatedAt,
        t.rawTranscript ?? t.transcript ?? "",
        t.correctedTranscript ?? t.transcript ?? "",
        JSON.stringify(t.summaries ?? EMPTY_SUMMARIES),
        JSON.stringify(t.details ?? EMPTY_DETAILS),
        JSON.stringify(t.ticketFields ?? EMPTY_TICKET_FIELDS),
        t.details?.storeNumber ?? "",
        t.details?.registerNumber ?? "",
        t.details?.callerName ?? "",
        t.details?.callerRole ?? "",
        t.ticketFields?.subject ?? "",
        t.ticketFields?.description ?? "",
        t.ticketFields?.resolution ?? "",
        t.ticketFields?.additionalComments ?? "",
        t.details?.category ?? "",
        t.details?.subCategory ?? "",
        t.details?.item ?? "",
        t.details?.transactionNumber ?? "",
        t.details?.itemNumber ?? "",
        t.details?.typeOfTransaction ?? "",
        t.details?.paymentType ?? "",
        t.details?.result ?? "",
        bool(t.details?.partNeeded),
        t.ticketFields?.partRequest ?? "",
        t.audioId ?? null,
        bool(t.reviewed),
        bool(t.copied),
        t.extractionSourceVersion ?? "",
        t.extractionTimestamp ?? "",
        t.detailLevel ?? "Normal",
        t.generatedTicket ?? "",
        t.details?.notes ?? "",
        JSON.stringify(t.transcriptVersions ?? []),
        JSON.stringify(t.copyLog ?? []),
        bool(t.copySequenceCompleted),
      ],
    );

    // Replace child rows wholesale — simpler and consistent with how upsert
    // semantics work for the rest of the SavedTicket shape.
    await db.execute(`DELETE FROM speaker_segments WHERE ticket_id = $1`, [t.id]);
    const segments = arr(t.speakerSegments);
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      await db.execute(
        `INSERT INTO speaker_segments (
          id, ticket_id, segment_index, original_text, repaired_text,
          speaker_label, confidence, reason, user_corrected,
          timestamp_start, timestamp_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          s.id || `${t.id}-seg-${i}`,
          t.id,
          i,
          s.originalText ?? "",
          s.repairedText ?? "",
          s.speakerLabel ?? "unknown",
          s.confidence ?? "medium",
          s.reason ?? "",
          bool(s.userCorrected),
          s.timestampStart ?? null,
          s.timestampEnd ?? null,
        ],
      );
    }

    await db.execute(`DELETE FROM correction_changes WHERE ticket_id = $1`, [t.id]);
    const changes = mergeCorrectionChanges(
      arr(t.correctionChanges),
      arr(t.approvedCorrections),
      arr(t.undoneCorrections),
    );
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      await db.execute(
        `INSERT INTO correction_changes (
          id, ticket_id, source, original_phrase, corrected_phrase,
          reason, confidence, approved, undone, auto_apply
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          `${t.id}-cc-${i}`,
          t.id,
          c.source,
          c.from,
          c.to,
          "",
          "",
          bool(c.approved),
          bool(c.undone),
          bool(c.autoApply),
        ],
      );
    }

    await db.execute(`DELETE FROM name_corrections_applied WHERE ticket_id = $1`, [t.id]);
    const names = arr(t.nameCorrectionsApplied);
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      await db.execute(
        `INSERT INTO name_corrections_applied (
          id, ticket_id, detected_name, corrected_name, confidence, saved_hint_used
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [`${t.id}-nc-${i}`, t.id, n.detected, n.corrected, "", 0],
      );
    }
}

interface MergedChange extends SavedCorrectionChange {
  approved: boolean;
  undone: boolean;
}

function mergeCorrectionChanges(
  base: SavedCorrectionChange[],
  approved: SavedCorrectionChange[],
  undone: SavedCorrectionChange[],
): MergedChange[] {
  const key = (c: SavedCorrectionChange) => `${c.source}::${c.from}=>${c.to}`;
  const out = new Map<string, MergedChange>();
  for (const c of base) {
    out.set(key(c), { ...c, approved: false, undone: false });
  }
  for (const c of approved) {
    const k = key(c);
    const existing = out.get(k);
    if (existing) existing.approved = true;
    else out.set(k, { ...c, approved: true, undone: false });
  }
  for (const c of undone) {
    const k = key(c);
    const existing = out.get(k);
    if (existing) existing.undone = true;
    else out.set(k, { ...c, approved: false, undone: true });
  }
  return [...out.values()];
}

async function sqliteDeleteTicket(id: string): Promise<void> {
  const db = await getDatabase();
  // ON DELETE CASCADE handles the child tables.
  await db.execute(`DELETE FROM tickets WHERE id = $1`, [id]);
}

async function sqliteClearAll(): Promise<void> {
  const db = await getDatabase();
  // Single DELETE is atomic on its own — see comment in sqliteWriteTicket
  // for why we avoid BEGIN/COMMIT across separate db.execute() calls.
  await db.execute(`DELETE FROM tickets`);
}

// ───────────────────────────────────────────────────────────────────────────
// SQLite hydration (read all rows → SavedTicket cache)
// ───────────────────────────────────────────────────────────────────────────

interface TicketRow {
  id: string;
  created_at: string;
  updated_at: string;
  raw_transcript: string;
  corrected_transcript: string;
  summaries_json: string;
  extracted_json: string;
  ticket_fields_json: string;
  reviewed: number;
  copied: number;
  extraction_source_version: string;
  extraction_timestamp: string;
  detail_level: string;
  generated_ticket: string;
  audio_id: string | null;
  transcript_versions_json: string | null;
  copy_log_json: string | null;
  copy_sequence_completed: number | null;
}

interface SegmentRow {
  id: string;
  ticket_id: string;
  segment_index: number;
  original_text: string;
  repaired_text: string;
  speaker_label: string;
  confidence: string;
  reason: string;
  user_corrected: number;
  timestamp_start: string | null;
  timestamp_end: string | null;
}

interface ChangeRow {
  id: string;
  ticket_id: string;
  source: string;
  original_phrase: string;
  corrected_phrase: string;
  approved: number;
  undone: number;
  auto_apply: number;
}

interface NameRow {
  id: string;
  ticket_id: string;
  detected_name: string;
  corrected_name: string;
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function hydrateFromSqlite(): Promise<void> {
  const db = await getDatabase();
  const tickets = await db.select<TicketRow[]>(
    `SELECT id, created_at, updated_at, raw_transcript, corrected_transcript,
            summaries_json, extracted_json, ticket_fields_json,
            reviewed, copied,
            extraction_source_version, extraction_timestamp,
            detail_level, generated_ticket,
            audio_id, transcript_versions_json,
            copy_log_json, copy_sequence_completed
       FROM tickets
       ORDER BY created_at DESC`,
  );
  const segments = await db.select<SegmentRow[]>(
    `SELECT id, ticket_id, segment_index, original_text, repaired_text,
            speaker_label, confidence, reason, user_corrected,
            timestamp_start, timestamp_end
       FROM speaker_segments
       ORDER BY ticket_id, segment_index`,
  );
  const changes = await db.select<ChangeRow[]>(
    `SELECT id, ticket_id, source, original_phrase, corrected_phrase,
            approved, undone, auto_apply
       FROM correction_changes`,
  );
  const names = await db.select<NameRow[]>(
    `SELECT id, ticket_id, detected_name, corrected_name
       FROM name_corrections_applied`,
  );

  const segByTicket = new Map<string, SegmentRow[]>();
  for (const s of segments) {
    let list = segByTicket.get(s.ticket_id);
    if (!list) {
      list = [];
      segByTicket.set(s.ticket_id, list);
    }
    list.push(s);
  }
  const chgByTicket = new Map<string, ChangeRow[]>();
  for (const c of changes) {
    let list = chgByTicket.get(c.ticket_id);
    if (!list) {
      list = [];
      chgByTicket.set(c.ticket_id, list);
    }
    list.push(c);
  }
  const nameByTicket = new Map<string, NameRow[]>();
  for (const n of names) {
    let list = nameByTicket.get(n.ticket_id);
    if (!list) {
      list = [];
      nameByTicket.set(n.ticket_id, list);
    }
    list.push(n);
  }

  cache.clear();
  for (const row of tickets) {
    const details = safeJson<ExtractedDetails>(row.extracted_json, EMPTY_DETAILS);
    const ticketFields = safeJson<TicketFields>(row.ticket_fields_json, EMPTY_TICKET_FIELDS);
    const summaries = safeJson<SummarySet>(row.summaries_json, EMPTY_SUMMARIES);

    const speakerSegments: SavedSpeakerSegment[] = (segByTicket.get(row.id) ?? []).map((s) => ({
      id: s.id,
      originalText: s.original_text,
      repairedText: s.repaired_text,
      speakerLabel: s.speaker_label,
      confidence: (s.confidence as SavedSpeakerSegment["confidence"]) ?? "medium",
      reason: s.reason,
      userCorrected: !!s.user_corrected,
      timestampStart: s.timestamp_start ?? undefined,
      timestampEnd: s.timestamp_end ?? undefined,
    }));

    const ticketChanges = chgByTicket.get(row.id) ?? [];
    const correctionChanges: SavedCorrectionChange[] = ticketChanges.map((c) => ({
      from: c.original_phrase,
      to: c.corrected_phrase,
      source: c.source as SavedCorrectionChange["source"],
      autoApply: !!c.auto_apply,
    }));
    const approvedCorrections = ticketChanges
      .filter((c) => c.approved)
      .map((c) => ({
        from: c.original_phrase,
        to: c.corrected_phrase,
        source: c.source as SavedCorrectionChange["source"],
        autoApply: !!c.auto_apply,
      }));
    const undoneCorrections = ticketChanges
      .filter((c) => c.undone)
      .map((c) => ({
        from: c.original_phrase,
        to: c.corrected_phrase,
        source: c.source as SavedCorrectionChange["source"],
        autoApply: !!c.auto_apply,
      }));

    const nameCorrectionsApplied: SavedNameCorrection[] = (nameByTicket.get(row.id) ?? []).map(
      (n) => ({ detected: n.detected_name, corrected: n.corrected_name }),
    );

    const ticket: SavedTicket = normalizeTicket({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      transcript: row.raw_transcript,
      rawTranscript: row.raw_transcript,
      correctedTranscript: row.corrected_transcript,
      details,
      summaries,
      ticketFields,
      generatedTicket: row.generated_ticket,
      detailLevel: (row.detail_level as DetailLevel) || "Normal",
      reviewed: !!row.reviewed,
      copied: !!row.copied,
      speakerSegments,
      userCorrectedSpeakerSegments: speakerSegments.filter((s) => s.userCorrected),
      correctionChanges,
      approvedCorrections,
      undoneCorrections,
      nameCorrectionsApplied,
      extractionSourceVersion: row.extraction_source_version,
      extractionTimestamp: row.extraction_timestamp,
      audioId: row.audio_id,
      transcriptVersions: safeJson<import("../types/audio").TranscriptVersion[]>(
        row.transcript_versions_json ?? "[]",
        [],
      ),
      copyLog: safeJson<import("../types/copyMode").CopyLogEntry[]>(
        row.copy_log_json ?? "[]",
        [],
      ),
      copySequenceCompleted: !!row.copy_sequence_completed,
    });
    cache.set(row.id, ticket);
  }
}

function hydrateFromLocalStorage(): void {
  cache.clear();
  const raw = readJson<SavedTicket[]>(TICKETS_KEY, []);
  for (const t of raw) {
    const normalized = normalizeTicket(t);
    cache.set(normalized.id, normalized);
  }
}

function persistAllToLocalStorage(): void {
  // Used by the localStorage backend on every write — preserves the existing
  // single-blob shape so a Phase-1 user without Tauri stays bit-compatible.
  writeJson(TICKETS_KEY, [...cache.values()]);
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * One-shot init called from `main.tsx` before render. Populates the in-memory
 * cache so synchronous reads work the moment React mounts. Idempotent.
 */
export async function initStorage(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (isTauriAvailable()) {
      try {
        await applySchema();
        await migrateAddTranscriptVersionsColumn();
        await migrateAddFeedbackOriginalColumns();
        await migrateAddCopyLogColumns();
        await hydrateFromSqlite();
        backend = "sqlite";
        initialized = true;
        // Hydrate the audio_files / feedback / style_examples caches after
        // the schema is applied so History badges + Inspect view have data
        // on first render. A failure here doesn't block the rest of the app.
        try {
          await initAudioFilesStore();
        } catch (e) {
          recordError("init/audioFiles", e);
        }
        try {
          await initTicketFeedbackStore();
        } catch (e) {
          recordError("init/ticketFeedback", e);
        }
        try {
          await initStyleExamplesStore();
        } catch (e) {
          recordError("init/styleExamples", e);
        }
        try {
          await initRemindersStore();
        } catch (e) {
          recordError("init/reminders", e);
        }
        try {
          await initKnowledgeStore();
        } catch (e) {
          recordError("init/knowledge", e);
        }
        return;
      } catch (e) {
        recordError("init/sqlite", e);
        // Fall through to localStorage so the app still boots.
      }
    }
    hydrateFromLocalStorage();
    backend = "localStorage";
    initialized = true;
    try {
      await initAudioFilesStore();
    } catch (e) {
      recordError("init/audioFiles", e);
    }
    try {
      await initTicketFeedbackStore();
    } catch (e) {
      recordError("init/ticketFeedback", e);
    }
    try {
      await initStyleExamplesStore();
    } catch (e) {
      recordError("init/styleExamples", e);
    }
    try {
      await initRemindersStore();
    } catch (e) {
      recordError("init/reminders", e);
    }
    try {
      await initKnowledgeStore();
    } catch (e) {
      recordError("init/knowledge", e);
    }
  })();

  return initPromise;
}

export function getStorageBackend(): StorageBackend {
  return backend;
}

export function getRecentStorageErrors(): RecentError[] {
  return [...recentErrors];
}

/**
 * Resolves once every queued SQLite write (and any preceding writes) has
 * settled. Used by the migration flow to guarantee Verify Migration runs
 * after every Run Migration write has hit disk.
 */
export async function flushPendingWrites(): Promise<void> {
  await sqliteTicketWriteQueue.flush();
}

export const ticketStore = {
  list(): SavedTicket[] {
    // Stable createdAt-desc sort, matching the legacy behavior.
    return [...cache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  get(id: string): SavedTicket | undefined {
    return cache.get(id);
  },

  upsert(ticket: SavedTicket): void {
    const normalized = normalizeTicket(ticket);
    cache.set(normalized.id, normalized);
    if (backend === "sqlite") {
      enqueue(`upsert(${normalized.id})`, () => sqliteWriteTicket(normalized));
    } else {
      // localStorage write is synchronous — let quota errors surface to the caller.
      try {
        persistAllToLocalStorage();
      } catch (e) {
        recordError(`upsert(${normalized.id})`, e);
        throw e;
      }
    }
  },

  remove(id: string): void {
    cache.delete(id);
    if (backend === "sqlite") {
      enqueue(`remove(${id})`, () => sqliteDeleteTicket(id));
    } else {
      try {
        persistAllToLocalStorage();
      } catch (e) {
        recordError(`remove(${id})`, e);
      }
    }
  },

  clearAll(): void {
    cache.clear();
    if (backend === "sqlite") {
      enqueue("clearAll", () => sqliteClearAll());
    } else {
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(TICKETS_KEY);
      } catch (e) {
        recordError("clearAll", e);
      }
    }
  },

  /**
   * Fast count for the migration UI without paying the sort cost of `list()`.
   */
  count(): number {
    return cache.size;
  },

  /**
   * Flip just the `reviewed` flag without loading the ticket as the current
   * workflow ticket. Lets History mark a ticket reviewed without clobbering
   * whatever the user is editing in the form.
   */
  setReviewed(id: string, reviewed: boolean): void {
    const existing = cache.get(id);
    if (!existing) return;
    if (existing.reviewed === reviewed) return;
    const updated: SavedTicket = {
      ...existing,
      reviewed,
      updatedAt: new Date().toISOString(),
    };
    cache.set(id, updated);
    if (backend === "sqlite") {
      enqueue(`setReviewed(${id})`, () => sqliteWriteTicket(updated));
    } else {
      try {
        persistAllToLocalStorage();
      } catch (e) {
        recordError(`setReviewed(${id})`, e);
        throw e;
      }
    }
  },
};

export const settingsStore = {
  load(): AppSettings {
    const stored = readJson<Partial<AppSettings>>(SETTINGS_KEY, {});
    // Nested objects don't merge with a single spread — settings stored
    // before Phase 6/9 lack reminderSettings / fieldMapping, so we defensively
    // backfill with defaults to keep downstream consumers safe.
    const reminderSettings = {
      ...DEFAULT_SETTINGS.reminderSettings,
      ...(stored.reminderSettings ?? {}),
    };
    const fieldMappingDefault = DEFAULT_SETTINGS.fieldMapping;
    const storedMapping = stored.fieldMapping;
    const fieldMapping =
      storedMapping && Array.isArray(storedMapping.entries)
        ? {
            ...fieldMappingDefault,
            ...storedMapping,
            entries: storedMapping.entries,
          }
        : fieldMappingDefault;
    return { ...DEFAULT_SETTINGS, ...stored, reminderSettings, fieldMapping };
  },
  save(settings: AppSettings): void {
    writeJson(SETTINGS_KEY, settings);
  },
  reset(): void {
    if (typeof localStorage !== "undefined") localStorage.removeItem(SETTINGS_KEY);
  },
};

// Internal — used only by the migration module. Not part of the stable
// public API; do not call from app code.
export const __internal = {
  readLocalStorageTickets(): SavedTicket[] {
    return readJson<SavedTicket[]>(TICKETS_KEY, []).map(normalizeTicket);
  },
  removeLocalStorageTickets(): void {
    if (typeof localStorage !== "undefined") localStorage.removeItem(TICKETS_KEY);
  },
  ticketsLocalStorageKey: TICKETS_KEY,
  hasLocalStorageTickets(): boolean {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(TICKETS_KEY) !== null;
  },
};
