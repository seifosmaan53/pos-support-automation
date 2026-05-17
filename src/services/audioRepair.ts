/**
 * Phase 12B — audio health classification + repair actions.
 *
 * Classifies the audio_files rows + audio directory contents into the three
 * buckets the repair wizard works with:
 *   • missing — SQLite says the file exists, but it isn't on disk.
 *   • orphan  — SQLite row exists but isn't clearly linked to a ticket
 *               (null ticketId, ticket has been hard-deleted, etc.).
 *   • unlinkedOnDisk — file on disk has no active SQLite row.
 *
 * Every destructive action goes through the wizard UI which wraps each call
 * in a ConfirmDialog — this module never asks the user; it only does the
 * work once the caller has confirmed.
 */
import { audioFilesStore } from "./audioFilesStore";
import { ticketStore } from "./databaseService";
import {
  checkPathsExist,
  isTauriDesktop,
  openInFolder,
} from "./systemStorage";
import {
  deleteAudioFile,
  importAudioFile,
  isPersistenceAvailable,
  listAudioFilesOnDisk,
  type OnDiskAudioFile,
} from "./audioStorage";
import { logError } from "./errorLog";
import type { AudioMetadata } from "../types/audio";
import { newId, nowIso } from "../utils/formatDate";

export interface MissingAudioRow {
  audio: AudioMetadata;
  expectedPath: string;
  linkedTicketId: string | null;
  linkedTicketSubject: string | null;
  createdAt: string;
  deleted: boolean;
}

export type OrphanReason =
  | "no-ticket"
  | "ticket-not-found"
  | "deleted-but-on-disk";

export interface OrphanAudioRow {
  audio: AudioMetadata;
  fileExists: boolean;
  linkedTicketId: string | null;
  reason: OrphanReason;
  reasonText: string;
}

export interface UnlinkedDiskFile extends OnDiskAudioFile {}

export interface AudioHealthScan {
  missing: MissingAudioRow[];
  orphan: OrphanAudioRow[];
  unlinkedOnDisk: UnlinkedDiskFile[];
  /** Total active SQLite rows (sanity-check value for the wizard banner). */
  activeRows: number;
  /** Total files on disk in the audio folder. */
  filesOnDisk: number;
}

export interface AudioHealthCounts {
  missing: number;
  orphan: number;
  unlinkedOnDisk: number;
}

export function toCounts(scan: AudioHealthScan): AudioHealthCounts {
  return {
    missing: scan.missing.length,
    orphan: scan.orphan.length,
    unlinkedOnDisk: scan.unlinkedOnDisk.length,
  };
}

function ticketSubject(id: string | null | undefined): string | null {
  if (!id) return null;
  const t = ticketStore.get(id);
  if (!t) return null;
  return (
    t.ticketFields?.subject?.trim() ||
    t.details?.issue?.trim() ||
    `Ticket ${id.slice(0, 8)}`
  );
}

function reasonTextFor(reason: OrphanReason): string {
  if (reason === "no-ticket") {
    return "Audio row exists but isn't linked to any ticket.";
  }
  if (reason === "ticket-not-found") {
    return "Audio row references a ticket that no longer exists.";
  }
  return "Audio row is marked deleted but the file is still on disk.";
}

/**
 * Walk every audio_files row and every WAV in the audio dir, sort them into
 * the three buckets. Designed to be safe to run repeatedly — the wizard
 * re-runs it after each action so the user always sees fresh counts.
 */
export async function scanAudioHealth(): Promise<AudioHealthScan> {
  const allRows = audioFilesStore.list();
  const activeRows = allRows.filter((m) => !m.deleted);
  const onDisk = await listAudioFilesOnDisk().catch((e) => {
    logError({
      source: "audio",
      op: "scanAudioHealth.listAudioFilesOnDisk",
      message: (e as Error).message,
      severity: "warning",
    });
    return [] as OnDiskAudioFile[];
  });
  const onDiskPaths = new Set(onDisk.map((f) => f.path));

  // 1) Missing: active rows whose path isn't on disk.
  const existence = await checkPathsExist(activeRows.map((r) => r.path)).catch((e) => {
    logError({
      source: "audio",
      op: "scanAudioHealth.checkPathsExist",
      message: (e as Error).message,
      severity: "warning",
    });
    return activeRows.map(() => false);
  });
  const missing: MissingAudioRow[] = [];
  activeRows.forEach((row, i) => {
    if (!existence[i]) {
      missing.push({
        audio: row,
        expectedPath: row.path,
        linkedTicketId: row.ticketId ?? null,
        linkedTicketSubject: ticketSubject(row.ticketId),
        createdAt: row.createdAt,
        deleted: row.deleted,
      });
    }
  });

  // 2) Orphan rows: rows with no ticket OR ticket missing OR deleted-but-on-disk.
  const orphan: OrphanAudioRow[] = [];
  for (const row of allRows) {
    // Deleted but still on disk → orphan worth surfacing so the user can
    // either delete the file or undelete the row.
    if (row.deleted && onDiskPaths.has(row.path)) {
      orphan.push({
        audio: row,
        fileExists: true,
        linkedTicketId: row.ticketId,
        reason: "deleted-but-on-disk",
        reasonText: reasonTextFor("deleted-but-on-disk"),
      });
      continue;
    }
    if (row.deleted) continue;

    if (!row.ticketId) {
      orphan.push({
        audio: row,
        fileExists: onDiskPaths.has(row.path),
        linkedTicketId: null,
        reason: "no-ticket",
        reasonText: reasonTextFor("no-ticket"),
      });
      continue;
    }
    if (!ticketStore.get(row.ticketId)) {
      orphan.push({
        audio: row,
        fileExists: onDiskPaths.has(row.path),
        linkedTicketId: row.ticketId,
        reason: "ticket-not-found",
        reasonText: reasonTextFor("ticket-not-found"),
      });
    }
  }

  // 3) Unlinked on disk: WAVs whose path isn't in any active row. Files
  // referenced by deleted=true rows still count as unlinked here because
  // they're effectively orphan from the user's "what should I do with this
  // file?" perspective; the wizard offers Delete-with-confirm for them.
  const linkedActivePaths = new Set(activeRows.map((r) => r.path));
  const unlinkedOnDisk = onDisk.filter((f) => !linkedActivePaths.has(f.path));

  return {
    missing,
    orphan,
    unlinkedOnDisk,
    activeRows: activeRows.length,
    filesOnDisk: onDisk.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Missing audio rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update an existing audio_files row to point at a different path. Used by
 * the "Locate File" action when the user finds the recording in a new
 * location and just wants to update the bookkeeping.
 */
export function relocateAudioRow(audioId: string, newPath: string): boolean {
  const existing = audioFilesStore.get(audioId);
  if (!existing) return false;
  audioFilesStore.upsert({ ...existing, path: newPath });
  return true;
}

/**
 * Replace the file backing an audio_files row by copying a user-chosen file
 * into the app audio dir and updating the row's path. Used by "Attach
 * Replacement File". Returns the new path on success.
 */
export async function attachReplacementForRow(
  audioId: string,
  sourcePath: string,
): Promise<string | null> {
  const existing = audioFilesStore.get(audioId);
  if (!existing) return null;
  const newPath = await importAudioFile(sourcePath);
  audioFilesStore.upsert({ ...existing, path: newPath });
  return newPath;
}

/**
 * Mark a row as deleted without touching the file (because there is no
 * file). The row stays in the table so History shows "Audio missing".
 */
export function markAudioRowMissing(audioId: string): boolean {
  const updated = audioFilesStore.markDeleted(audioId);
  return !!updated;
}

/**
 * Permanently remove the audio_files row. The wizard wraps this in a
 * confirmation. We use the existing `markDeleted` rather than a hard
 * delete to keep the soft-delete audit trail intact — but if the spec
 * really wants "delete metadata", we soft-delete here and let the user
 * understand "Delete Audio Metadata" means the row is hidden from active
 * listings.
 *
 * NOTE: The audioFilesStore intentionally has no `remove` method — every
 * delete is soft. That's a deliberate design choice from Phase 11D so we
 * never lose audit history.
 */
export function deleteAudioMetadata(audioId: string): boolean {
  return markAudioRowMissing(audioId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Orphan audio rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Link an orphan row to a saved ticket. The previous attachment for that
 * ticket (if any) is marked deleted so a ticket never has two competing
 * active rows.
 */
export function linkAudioToTicket(audioId: string, ticketId: string): boolean {
  const existing = audioFilesStore.get(audioId);
  if (!existing) return false;
  if (!ticketStore.get(ticketId)) return false;
  // Demote any other active row for the ticket
  const others = audioFilesStore
    .list()
    .filter((m) => !m.deleted && m.ticketId === ticketId && m.id !== audioId);
  for (const o of others) {
    audioFilesStore.markDeleted(o.id);
  }
  audioFilesStore.upsert({ ...existing, ticketId });
  return true;
}

export async function revealAudioRowInFolder(audioId: string): Promise<void> {
  const m = audioFilesStore.get(audioId);
  if (!m) throw new Error("Audio row not found.");
  // Open the *folder* containing the file, not the file itself, so this
  // works whether or not the file exists right now.
  const sep = m.path.lastIndexOf("/");
  const folder = sep > 0 ? m.path.slice(0, sep) : m.path;
  if (!isTauriDesktop()) {
    throw new Error("Opening folders requires the Tauri desktop app.");
  }
  await openInFolder(folder);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Audio files on disk not linked to tickets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new audio_files row for a disk file and link it to a ticket.
 * Marks any other active row on the same ticket as deleted.
 */
export function attachDiskFileToTicket(
  path: string,
  ticketId: string,
): AudioMetadata | null {
  if (!ticketStore.get(ticketId)) return null;
  const others = audioFilesStore
    .list()
    .filter((m) => !m.deleted && m.ticketId === ticketId);
  for (const o of others) {
    audioFilesStore.markDeleted(o.id);
  }
  const row: AudioMetadata = {
    id: newId(),
    ticketId,
    path,
    durationMs: 0,
    format: inferFormatFromPath(path),
    createdAt: nowIso(),
    deleted: false,
    transcriptStatus: "",
  };
  audioFilesStore.upsert(row);
  // Update the linked ticket's audioId so History badges + AudioStatusCard
  // see the new link without needing a re-render trigger.
  const t = ticketStore.get(ticketId);
  if (t) {
    ticketStore.upsert({ ...t, audioId: row.id, updatedAt: nowIso() });
  }
  return row;
}

/**
 * Create a new audio_files row for a disk file with no ticket linked. The
 * row is active (deleted=false) but ticketId=null — so the file is no
 * longer "unlinked on disk" in subsequent scans, but it also doesn't get
 * counted toward any ticket.
 */
export function importDiskFileAsUnlinked(path: string): AudioMetadata {
  const row: AudioMetadata = {
    id: newId(),
    ticketId: null,
    path,
    durationMs: 0,
    format: inferFormatFromPath(path),
    createdAt: nowIso(),
    deleted: false,
    transcriptStatus: "",
  };
  audioFilesStore.upsert(row);
  return row;
}

/**
 * Permanently delete a disk audio file. Asks the caller to confirm — this
 * is the only entry point that touches the disk. Used by Step 3 of the
 * wizard. If a deleted=true row points at the same path, leave it; the
 * row stays as audit history but the file is gone.
 */
export async function deleteDiskFile(path: string): Promise<void> {
  if (!isPersistenceAvailable()) {
    throw new Error("Deleting files requires the Tauri desktop app.");
  }
  await deleteAudioFile(path);
}

function inferFormatFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "wav";
  return path.slice(dot + 1).toLowerCase() || "wav";
}
