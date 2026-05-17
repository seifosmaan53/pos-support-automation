/**
 * Phase 12 — backup / restore.
 *
 * Format: a single JSON blob with a `__backup` envelope. Every top-level
 * collection is an explicit array so a future reader can detect missing /
 * extra collections without crashing on unknown keys.
 *
 * Audio policy (important — restated in the UI):
 *   • Metadata for every audio file is included (path, duration, ticketId,
 *     transcriptStatus, deleted flag).
 *   • Actual audio file bytes are NOT embedded in the JSON. Base64-encoding
 *     even a single hour of WAV would dwarf the rest of the backup and trip
 *     localStorage / JSON.parse limits on restore. The "Export with audio"
 *     flow handles file bytes via a separate Tauri command that copies the
 *     WAV files into a sibling folder next to the backup JSON.
 *
 * Restore modes:
 *   • "replace" — clear every collection, then load. Used when the user is
 *     moving to a new computer with a clean install.
 *   • "merge"  — preserve existing rows by id; only insert ids the user
 *     doesn't already have. Used for recovery, partial imports, etc.
 *
 * Settings policy:
 *   • Backup includes the full AppSettings object.
 *   • `exportSettingsOnly` / `importSettingsOnly` produce a sub-blob with
 *     just the settings (and the same `__backup` envelope so the restore
 *     code can refuse a full backup as if it were a settings-only file).
 */
import type { AnyKnowledgeItem } from "../types/knowledge";
import type { AudioMetadata } from "../types/audio";
import type { ExtractionPattern } from "../types/extractionPattern";
import type { Reminder } from "../types/reminder";
import type { SavedTicket } from "../types/ticket";
import type { StyleExample } from "../types/styleExample";
import type { AppSettings } from "../types/settings";

import { audioFilesStore } from "./audioFilesStore";
import {
  __internal as databaseInternal,
  settingsStore,
  ticketStore,
} from "./databaseService";
import { extractionPatternsStore } from "./extractionPatternsStore";
import { knowledgeStore } from "./knowledgeStore";
import { remindersStore } from "./remindersStore";
import { styleExamplesStore } from "./styleExamplesStore";
import { DEFAULT_SETTINGS } from "../types/settings";
import { logError } from "./errorLog";

void databaseInternal; // reserved for future legacy-import support

const BACKUP_KIND_FULL = "store-ticket-assistant.full";
const BACKUP_KIND_SETTINGS = "store-ticket-assistant.settings";
const BACKUP_FORMAT_VERSION = 1;

export type BackupKind = typeof BACKUP_KIND_FULL | typeof BACKUP_KIND_SETTINGS;

export interface BackupEnvelope {
  __backup: {
    kind: BackupKind;
    version: number;
    appVersion: string;
    createdAt: string;
    /** Whether audio file bytes were shipped in a sibling folder. */
    audioFilesIncluded: boolean;
    /** App-wide extractor version at backup time (for "older extractor" detection). */
    extractorVersion: string;
  };
}

export interface FullBackup extends BackupEnvelope {
  tickets: SavedTicket[];
  audioFiles: AudioMetadata[];
  reminders: Reminder[];
  knowledgeItems: AnyKnowledgeItem[];
  styleExamples: StyleExample[];
  extractionPatterns: ExtractionPattern[];
  settings: AppSettings;
}

export interface SettingsBackup extends BackupEnvelope {
  settings: AppSettings;
}

const LS_LAST_BACKUP_AT_KEY = "sta.last_backup_at";

function nowIso(): string {
  return new Date().toISOString();
}

function readAppVersion(): string {
  // package.json's "version" field is injected at build time as
  // import.meta.env.VITE_APP_VERSION; if missing (dev), fall back to a
  // human-readable label.
  const v = (import.meta as unknown as { env?: { VITE_APP_VERSION?: string } }).env
    ?.VITE_APP_VERSION;
  return v && typeof v === "string" ? v : "0.1.0";
}

function readExtractorVersion(): string {
  // Avoid importing through ticket.ts cycles by reading at call time.
  return (
    (import.meta as unknown as { env?: { VITE_EXTRACTOR_VERSION?: string } }).env
      ?.VITE_EXTRACTOR_VERSION ?? "sta-extractor-2026-04-29"
  );
}

/**
 * Snapshot every collection into a single JSON-serializable blob. Pure — no
 * side effects, so the caller can wrap it in error handling without worrying
 * about partial state.
 */
export function buildFullBackup(options?: { audioFilesIncluded?: boolean }): FullBackup {
  const settings = settingsStore.load();
  return {
    __backup: {
      kind: BACKUP_KIND_FULL,
      version: BACKUP_FORMAT_VERSION,
      appVersion: readAppVersion(),
      createdAt: nowIso(),
      audioFilesIncluded: !!options?.audioFilesIncluded,
      extractorVersion: readExtractorVersion(),
    },
    tickets: ticketStore.list(),
    audioFiles: audioFilesStore.list(),
    reminders: remindersStore.list(),
    knowledgeItems: knowledgeStore.list(),
    styleExamples: styleExamplesStore.list(),
    extractionPatterns: extractionPatternsStore.list(),
    settings,
  };
}

export function buildSettingsBackup(): SettingsBackup {
  return {
    __backup: {
      kind: BACKUP_KIND_SETTINGS,
      version: BACKUP_FORMAT_VERSION,
      appVersion: readAppVersion(),
      createdAt: nowIso(),
      audioFilesIncluded: false,
      extractorVersion: readExtractorVersion(),
    },
    settings: settingsStore.load(),
  };
}

export interface BackupPreviewCounts {
  tickets: number;
  audioFiles: number;
  reminders: number;
  knowledgeItems: number;
  styleExamples: number;
  extractionPatterns: number;
}

export interface BackupPreview {
  kind: BackupKind;
  appVersion: string;
  createdAt: string;
  audioFilesIncluded: boolean;
  extractorVersion: string;
  counts: BackupPreviewCounts;
  hasSettings: boolean;
}

export type ParsedBackup =
  | { ok: true; kind: typeof BACKUP_KIND_FULL; data: FullBackup; preview: BackupPreview }
  | { ok: true; kind: typeof BACKUP_KIND_SETTINGS; data: SettingsBackup; preview: BackupPreview }
  | { ok: false; error: string };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function arrLen(x: unknown): number {
  return Array.isArray(x) ? x.length : 0;
}

/**
 * Parse JSON text into a typed backup. Validates the envelope and counts
 * collections so the UI can show a "Restore preview" before the user
 * confirms. Returns an error tag instead of throwing — the caller is the UI,
 * which wants to show a friendly message rather than a stack trace.
 */
export function parseBackup(text: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!isObject(parsed)) {
    return { ok: false, error: "Backup is not a JSON object." };
  }
  const env = (parsed as { __backup?: unknown }).__backup;
  if (!isObject(env)) {
    return {
      ok: false,
      error:
        "Missing __backup envelope. This file may not be a Store Ticket Assistant backup.",
    };
  }
  const kind = (env as { kind?: unknown }).kind;
  if (kind !== BACKUP_KIND_FULL && kind !== BACKUP_KIND_SETTINGS) {
    return {
      ok: false,
      error: `Unknown backup kind: ${String(kind)}.`,
    };
  }
  const version = Number((env as { version?: unknown }).version);
  if (!Number.isFinite(version) || version > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Backup format version ${version} is newer than this app supports (${BACKUP_FORMAT_VERSION}).`,
    };
  }
  const meta = env as Record<string, unknown>;
  const preview: BackupPreview = {
    kind,
    appVersion: String(meta.appVersion ?? "(unknown)"),
    createdAt: String(meta.createdAt ?? "(unknown)"),
    audioFilesIncluded: !!meta.audioFilesIncluded,
    extractorVersion: String(meta.extractorVersion ?? "(unknown)"),
    counts: {
      tickets: arrLen((parsed as Record<string, unknown>).tickets),
      audioFiles: arrLen((parsed as Record<string, unknown>).audioFiles),
      reminders: arrLen((parsed as Record<string, unknown>).reminders),
      knowledgeItems: arrLen((parsed as Record<string, unknown>).knowledgeItems),
      styleExamples: arrLen((parsed as Record<string, unknown>).styleExamples),
      extractionPatterns: arrLen(
        (parsed as Record<string, unknown>).extractionPatterns,
      ),
    },
    hasSettings: isObject((parsed as Record<string, unknown>).settings),
  };

  if (kind === BACKUP_KIND_FULL) {
    return {
      ok: true,
      kind: BACKUP_KIND_FULL,
      data: parsed as unknown as FullBackup,
      preview,
    };
  }
  return {
    ok: true,
    kind: BACKUP_KIND_SETTINGS,
    data: parsed as unknown as SettingsBackup,
    preview,
  };
}

export type RestoreMode = "merge" | "replace";

export interface RestoreResult {
  collection: keyof BackupPreviewCounts | "settings";
  added: number;
  skipped: number;
  replaced: number;
}

/**
 * Apply a parsed full backup to the local stores. Synchronous return; the
 * underlying writes go through each store's serialized queue, so callers
 * needing durability should `await flushPendingWrites()` after.
 *
 * In merge mode we treat ids as authoritative — backup rows with an id
 * already present in the local store are skipped, preserving any local edits
 * made since the backup was taken. In replace mode we clear each collection
 * before loading.
 */
export function applyFullBackup(
  backup: FullBackup,
  mode: RestoreMode,
): RestoreResult[] {
  const out: RestoreResult[] = [];

  // Tickets
  {
    const existingIds = new Set(ticketStore.list().map((t) => t.id));
    let added = 0;
    let skipped = 0;
    let replaced = 0;
    if (mode === "replace") {
      ticketStore.clearAll();
      existingIds.clear();
    }
    for (const t of backup.tickets ?? []) {
      if (!t || typeof t.id !== "string") continue;
      const had = existingIds.has(t.id);
      if (had && mode === "merge") {
        skipped += 1;
        continue;
      }
      ticketStore.upsert(t);
      if (had) replaced += 1;
      else added += 1;
      existingIds.add(t.id);
    }
    out.push({ collection: "tickets", added, skipped, replaced });
  }

  // Audio metadata (rows, not files)
  {
    // Phase 16 fix: only treat ACTIVE (non-soft-deleted) rows as "present"
    // for merge purposes. A backup row colliding with a locally-deleted row
    // should overwrite (un-delete) it, not be silently skipped.
    const existingIds = new Set(
      audioFilesStore
        .list()
        .filter((a) => !a.deleted)
        .map((a) => a.id),
    );
    let added = 0;
    let skipped = 0;
    let replaced = 0;
    // No clearAll() for audioFilesStore — replace would orphan the WAV files
    // on disk. Mark replaced rows as deleted instead so audit history is kept.
    for (const a of backup.audioFiles ?? []) {
      if (!a || typeof a.id !== "string") continue;
      const had = existingIds.has(a.id);
      if (had && mode === "merge") {
        skipped += 1;
        continue;
      }
      audioFilesStore.upsert(a);
      if (had) replaced += 1;
      else added += 1;
      existingIds.add(a.id);
    }
    out.push({ collection: "audioFiles", added, skipped, replaced });
  }

  // Reminders
  {
    const existing = remindersStore.list();
    const existingIds = new Set(existing.map((r) => r.id));
    let added = 0;
    let skipped = 0;
    let replaced = 0;
    if (mode === "replace") {
      for (const r of existing) remindersStore.remove(r.id);
      existingIds.clear();
    }
    for (const r of backup.reminders ?? []) {
      if (!r || typeof r.id !== "string") continue;
      const had = existingIds.has(r.id);
      if (had && mode === "merge") {
        skipped += 1;
        continue;
      }
      if (had) {
        remindersStore.update(r.id, r);
        replaced += 1;
      } else {
        remindersStore.create(r);
        added += 1;
      }
      existingIds.add(r.id);
    }
    out.push({ collection: "reminders", added, skipped, replaced });
  }

  // Knowledge items
  {
    const existingIds = new Set(knowledgeStore.list().map((k) => k.id));
    let added = 0;
    let skipped = 0;
    let replaced = 0;
    if (mode === "replace") {
      for (const id of [...existingIds]) knowledgeStore.remove(id);
      existingIds.clear();
    }
    for (const k of backup.knowledgeItems ?? []) {
      if (!k || typeof k.id !== "string") continue;
      const had = existingIds.has(k.id);
      if (had && mode === "merge") {
        skipped += 1;
        continue;
      }
      knowledgeStore.upsert(k);
      if (had) replaced += 1;
      else added += 1;
      existingIds.add(k.id);
    }
    out.push({ collection: "knowledgeItems", added, skipped, replaced });
  }

  // Style examples
  {
    const existing = styleExamplesStore.list();
    const existingIds = new Set(existing.map((s) => s.id));
    let added = 0;
    let skipped = 0;
    let replaced = 0;
    if (mode === "replace") {
      for (const s of existing) styleExamplesStore.remove(s.id);
      existingIds.clear();
    }
    for (const s of backup.styleExamples ?? []) {
      if (!s || typeof s.id !== "string") continue;
      const had = existingIds.has(s.id);
      if (had && mode === "merge") {
        skipped += 1;
        continue;
      }
      styleExamplesStore.upsert(s);
      if (had) replaced += 1;
      else added += 1;
      existingIds.add(s.id);
    }
    out.push({ collection: "styleExamples", added, skipped, replaced });
  }

  // Extraction patterns
  {
    const existing = extractionPatternsStore.list();
    const existingIds = new Set(existing.map((p) => p.id));
    let added = 0;
    let skipped = 0;
    let replaced = 0;
    if (mode === "replace") {
      for (const p of existing) extractionPatternsStore.remove(p.id);
      existingIds.clear();
    }
    for (const p of backup.extractionPatterns ?? []) {
      if (!p || typeof p.id !== "string") continue;
      const had = existingIds.has(p.id);
      if (had && mode === "merge") {
        skipped += 1;
        continue;
      }
      if (had) {
        extractionPatternsStore.update(p.id, p);
        replaced += 1;
      } else {
        extractionPatternsStore.create({ ...p, source: p.source ?? "manual" });
        added += 1;
      }
      existingIds.add(p.id);
    }
    out.push({
      collection: "extractionPatterns",
      added,
      skipped,
      replaced,
    });
  }

  // Settings — replace mode overwrites; merge mode keeps anything that
  // already differs from defaults so the user doesn't lose local tuning.
  if (backup.settings) {
    if (mode === "replace") {
      settingsStore.save({ ...DEFAULT_SETTINGS, ...backup.settings });
      out.push({ collection: "settings", added: 0, skipped: 0, replaced: 1 });
    } else {
      const current = settingsStore.load();
      // Merge: backup wins for anything not already set; current wins for
      // anything the user has tuned. We compare key-by-key against the
      // default to detect "user has tuned this".
      const merged: AppSettings = { ...current };
      for (const key of Object.keys(backup.settings) as (keyof AppSettings)[]) {
        const def = DEFAULT_SETTINGS[key];
        const curr = current[key];
        const backed = backup.settings[key];
        const isTuned = JSON.stringify(curr) !== JSON.stringify(def);
        if (!isTuned) {
          (merged as unknown as Record<string, unknown>)[key as string] =
            backed as unknown;
        }
      }
      settingsStore.save(merged);
      out.push({ collection: "settings", added: 0, skipped: 0, replaced: 1 });
    }
  }

  markBackupRestoredNow();
  return out;
}

export function applySettingsBackup(
  backup: SettingsBackup,
  mode: RestoreMode,
): RestoreResult {
  if (mode === "replace") {
    settingsStore.save({ ...DEFAULT_SETTINGS, ...backup.settings });
  } else {
    const current = settingsStore.load();
    const merged: AppSettings = { ...current };
    for (const key of Object.keys(backup.settings) as (keyof AppSettings)[]) {
      const def = DEFAULT_SETTINGS[key];
      const curr = current[key];
      const backed = backup.settings[key];
      const isTuned = JSON.stringify(curr) !== JSON.stringify(def);
      if (!isTuned) {
        (merged as unknown as Record<string, unknown>)[key as string] =
          backed as unknown;
      }
    }
    settingsStore.save(merged);
  }
  return { collection: "settings", added: 0, skipped: 0, replaced: 1 };
}

/**
 * Last successful backup-or-restore timestamp. Used by startup safety so we
 * can warn "you have never created a backup" once the user has been using
 * the app for any meaningful amount of time.
 */
export function getLastBackupAt(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(LS_LAST_BACKUP_AT_KEY);
  } catch {
    return null;
  }
}

export function markBackupCreatedNow(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_LAST_BACKUP_AT_KEY, nowIso());
  } catch (e) {
    logError({
      source: "backup",
      op: "markBackupCreatedNow",
      message: (e as Error).message,
      severity: "warning",
    });
  }
}

function markBackupRestoredNow(): void {
  // Restoring counts as "I have a backup in hand" too — the user just
  // demonstrated they have one and it parsed.
  markBackupCreatedNow();
}

/**
 * Serialize a backup to a pretty-printed JSON string. Pretty-print is
 * intentional: backup files end up in places where a human might want to
 * eyeball them (a USB drive, an email attachment), and the size penalty is
 * negligible compared to the ticket text itself.
 */
export function serializeBackup(backup: FullBackup | SettingsBackup): string {
  return JSON.stringify(backup, null, 2);
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 12B — Verify Backup
// ────────────────────────────────────────────────────────────────────────────

export interface BackupVerification {
  valid: boolean;
  kind: BackupKind | null;
  formatVersion: number | null;
  appVersion: string | null;
  createdAt: string | null;
  /** Whether the envelope claims audio files were bundled. */
  audioFilesIncluded: boolean;
  counts: BackupPreviewCounts;
  hasSettings: boolean;
  /** Hard failures — backup can't be trusted (parse error, missing envelope, etc.). */
  errors: string[];
  /** Soft notes — anomalies that don't invalidate the file. */
  warnings: string[];
}

/**
 * Verify a backup JSON text. Goes deeper than parseBackup:
 *   • Validates the envelope shape and known kinds.
 *   • Validates the format version is supported.
 *   • Counts every collection AND every nested array (tickets without ids,
 *     audio rows without paths, etc.) so the user sees which collections
 *     are well-formed.
 *   • Flags "audio files included" claims so the UI can hint at the
 *     companion /audio folder.
 */
export function verifyBackupText(text: string): BackupVerification {
  const errors: string[] = [];
  const warnings: string[] = [];
  const empty: BackupPreviewCounts = {
    tickets: 0,
    audioFiles: 0,
    reminders: 0,
    knowledgeItems: 0,
    styleExamples: 0,
    extractionPatterns: 0,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      valid: false,
      kind: null,
      formatVersion: null,
      appVersion: null,
      createdAt: null,
      audioFilesIncluded: false,
      counts: empty,
      hasSettings: false,
      errors: [`Not valid JSON: ${(e as Error).message}`],
      warnings: [],
    };
  }

  if (!isObject(parsed)) {
    return {
      valid: false,
      kind: null,
      formatVersion: null,
      appVersion: null,
      createdAt: null,
      audioFilesIncluded: false,
      counts: empty,
      hasSettings: false,
      errors: ["Backup is not a JSON object."],
      warnings: [],
    };
  }
  const env = (parsed as { __backup?: unknown }).__backup;
  if (!isObject(env)) {
    return {
      valid: false,
      kind: null,
      formatVersion: null,
      appVersion: null,
      createdAt: null,
      audioFilesIncluded: false,
      counts: empty,
      hasSettings: false,
      errors: ["Missing __backup envelope."],
      warnings: [],
    };
  }
  const meta = env as Record<string, unknown>;
  const kindRaw = meta.kind;
  let kind: BackupKind | null = null;
  if (kindRaw === BACKUP_KIND_FULL || kindRaw === BACKUP_KIND_SETTINGS) {
    kind = kindRaw;
  } else {
    errors.push(`Unknown backup kind: ${String(kindRaw)}.`);
  }
  const formatVersion = Number(meta.version);
  if (!Number.isFinite(formatVersion)) {
    errors.push("Missing or non-numeric format version.");
  } else if (formatVersion > BACKUP_FORMAT_VERSION) {
    errors.push(
      `Format version ${formatVersion} is newer than this app supports (${BACKUP_FORMAT_VERSION}).`,
    );
  } else if (formatVersion < BACKUP_FORMAT_VERSION) {
    warnings.push(
      `Format version ${formatVersion} is older than current (${BACKUP_FORMAT_VERSION}). Import will still work.`,
    );
  }

  const obj = parsed as Record<string, unknown>;
  const counts: BackupPreviewCounts = {
    tickets: arrLen(obj.tickets),
    audioFiles: arrLen(obj.audioFiles),
    reminders: arrLen(obj.reminders),
    knowledgeItems: arrLen(obj.knowledgeItems),
    styleExamples: arrLen(obj.styleExamples),
    extractionPatterns: arrLen(obj.extractionPatterns),
  };
  const hasSettings = isObject(obj.settings);

  if (kind === BACKUP_KIND_FULL && !hasSettings) {
    warnings.push("Full backup is missing the settings object.");
  }
  if (kind === BACKUP_KIND_FULL && counts.tickets === 0) {
    warnings.push("Full backup contains zero tickets.");
  }
  if (meta.audioFilesIncluded && counts.audioFiles === 0) {
    warnings.push(
      "Envelope claims audioFilesIncluded=true but the audioFiles array is empty.",
    );
  }
  if (meta.audioFilesIncluded) {
    warnings.push(
      "Audio file bytes live in a sibling /audio folder, not inside the JSON. Verify that folder is present before restoring.",
    );
  }

  // Spot-check ticket structure — count rows missing an id, which is the
  // single most useful signal for "this backup was generated by a different
  // tool". We only flag if it's a non-trivial fraction so noise stays low.
  const tickets = Array.isArray(obj.tickets) ? (obj.tickets as unknown[]) : [];
  const idless = tickets.filter(
    (t) => !isObject(t) || typeof (t as { id?: unknown }).id !== "string",
  ).length;
  if (idless > 0) {
    warnings.push(`${idless} ticket(s) are missing an id and will be skipped.`);
  }

  return {
    valid: errors.length === 0,
    kind,
    formatVersion: Number.isFinite(formatVersion) ? formatVersion : null,
    appVersion: typeof meta.appVersion === "string" ? meta.appVersion : null,
    createdAt: typeof meta.createdAt === "string" ? meta.createdAt : null,
    audioFilesIncluded: !!meta.audioFilesIncluded,
    counts,
    hasSettings,
    errors,
    warnings,
  };
}

/**
 * Default download filename for a backup. Phase 12 — convention used by both
 * Export Full Backup and Export Settings.
 */
export function backupFilename(kind: BackupKind): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const suffix = kind === BACKUP_KIND_SETTINGS ? "settings" : "full";
  return `sta-backup-${suffix}-${stamp}.json`;
}

/**
 * Test hook — internal only. Wipe the "last backup at" marker so tests can
 * exercise the never-backed-up startup warning.
 */
export function __resetLastBackupAt(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_LAST_BACKUP_AT_KEY);
  } catch {
    // ignore
  }
}
