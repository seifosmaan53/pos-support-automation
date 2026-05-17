/**
 * Audio + transcript-version types for Phase 3.
 *
 * `AudioMetadata` mirrors the `audio_files` SQLite table 1:1 so persistence
 * is a flat field-for-field write. `TranscriptVersion` is intentionally
 * shaped so it can either live as a JSON array on the ticket row (current
 * design) or graduate to a `transcript_versions` table later without
 * changing the in-memory shape.
 */

export type TranscriptSource =
  | "original"
  | "whisper"
  | "edited"
  | "re-transcribed";

export interface TranscriptVersion {
  id: string;
  source: TranscriptSource;
  text: string;
  createdAt: string;
  /** ggml model filename, when known — for traceability only. */
  whisperModel?: string;
  notes?: string;
}

export type TranscriptStatus =
  | ""
  | "pending"
  | "transcribed"
  | "re-transcribed"
  | "failed";

/**
 * Mirrors the `audio_files` row. `id` is the ticket-independent primary key
 * we store on the ticket (`SavedTicket.audioId`). When the user clicks Delete
 * Audio we flip `deleted = true` rather than removing the row so History can
 * still show "Audio deleted" and we keep an audit trail.
 */
export interface AudioMetadata {
  id: string;
  ticketId: string | null;
  path: string;
  durationMs: number;
  format: string;
  createdAt: string;
  deleted: boolean;
  transcriptStatus: TranscriptStatus;
}
