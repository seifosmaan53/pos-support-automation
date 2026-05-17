/**
 * SQLite DDL for Store Ticket Assistant. All statements are idempotent
 * (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) so calling
 * `applySchema` repeatedly is safe.
 *
 * Design choices:
 * - Top-level scalar fields the user will filter or search on are
 *   denormalized into columns on `tickets` (store_number, caller_name,
 *   subject, description, resolution, category, result, etc.).
 * - The richer nested shapes (full ExtractedDetails, full TicketFields,
 *   the full SummarySet) are kept as JSON columns. We never query inside
 *   them, the data round-trips losslessly, and migration becomes trivial.
 * - speaker_segments / correction_changes / name_corrections_applied are
 *   normalized into child tables because Phase 3 (correction learning)
 *   will aggregate over them across tickets.
 * - audio_files / style_examples / ticket_feedback / reminders /
 *   knowledge_items / settings are created now per the Phase 1 spec but
 *   will be wired by Phase 3 — the tables exist so migrations don't
 *   need to alter the schema later.
 */

export const SCHEMA_VERSION = 3;

export const SCHEMA_STATEMENTS: readonly string[] = [
  // Internal metadata table — schema_version, migration_status, etc.
  `CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  // ── Core ticket row ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    raw_transcript TEXT NOT NULL DEFAULT '',
    corrected_transcript TEXT NOT NULL DEFAULT '',
    -- JSON blobs for nested shapes we do not query inside
    summaries_json TEXT NOT NULL DEFAULT '{}',
    extracted_json TEXT NOT NULL DEFAULT '{}',
    ticket_fields_json TEXT NOT NULL DEFAULT '{}',
    -- Denormalized scalars for filter/search (Phase 2)
    store_number TEXT NOT NULL DEFAULT '',
    register_number TEXT NOT NULL DEFAULT '',
    caller_name TEXT NOT NULL DEFAULT '',
    caller_role TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    resolution TEXT NOT NULL DEFAULT '',
    additional_comments TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    sub_category TEXT NOT NULL DEFAULT '',
    item TEXT NOT NULL DEFAULT '',
    transaction_number TEXT NOT NULL DEFAULT '',
    item_number TEXT NOT NULL DEFAULT '',
    type_of_transaction TEXT NOT NULL DEFAULT '',
    payment_type TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    part_needed INTEGER NOT NULL DEFAULT 0,
    part_request TEXT NOT NULL DEFAULT '',
    audio_id TEXT,
    reviewed INTEGER NOT NULL DEFAULT 0,
    copied INTEGER NOT NULL DEFAULT 0,
    extraction_source_version TEXT NOT NULL DEFAULT '',
    extraction_timestamp TEXT NOT NULL DEFAULT '',
    detail_level TEXT NOT NULL DEFAULT 'Normal',
    generated_ticket TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    transcript_versions_json TEXT NOT NULL DEFAULT '[]'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_store_number ON tickets(store_number)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_result ON tickets(result)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category)`,

  // ── Speaker segments ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS speaker_segments (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    original_text TEXT NOT NULL DEFAULT '',
    repaired_text TEXT NOT NULL DEFAULT '',
    speaker_label TEXT NOT NULL DEFAULT 'unknown',
    confidence TEXT NOT NULL DEFAULT 'medium',
    reason TEXT NOT NULL DEFAULT '',
    user_corrected INTEGER NOT NULL DEFAULT 0,
    timestamp_start TEXT,
    timestamp_end TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_speaker_segments_ticket ON speaker_segments(ticket_id, segment_index)`,

  // ── Correction changes (transcript repair audit trail) ─────────────
  `CREATE TABLE IF NOT EXISTS correction_changes (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    original_phrase TEXT NOT NULL,
    corrected_phrase TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    confidence TEXT NOT NULL DEFAULT '',
    approved INTEGER NOT NULL DEFAULT 0,
    undone INTEGER NOT NULL DEFAULT 0,
    auto_apply INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_correction_changes_ticket ON correction_changes(ticket_id)`,

  // ── Name corrections applied per ticket ────────────────────────────
  `CREATE TABLE IF NOT EXISTS name_corrections_applied (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    detected_name TEXT NOT NULL,
    corrected_name TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT '',
    saved_hint_used INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_name_corrections_ticket ON name_corrections_applied(ticket_id)`,

  // ── Audio file metadata (Phase 3 will wire playback/management) ────
  `CREATE TABLE IF NOT EXISTS audio_files (
    id TEXT PRIMARY KEY,
    ticket_id TEXT,
    path TEXT NOT NULL,
    duration INTEGER NOT NULL DEFAULT 0,
    format TEXT NOT NULL DEFAULT 'wav',
    created_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    transcript_status TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audio_files_ticket ON audio_files(ticket_id)`,

  // ── Style examples (Phase 3) ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS style_examples (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    raw_input TEXT NOT NULL DEFAULT '',
    ideal_subject TEXT NOT NULL DEFAULT '',
    ideal_description TEXT NOT NULL DEFAULT '',
    ideal_resolution TEXT NOT NULL DEFAULT '',
    ideal_part_request TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,

  // ── Ticket feedback / correction learning (Phase 3) ────────────────
  `CREATE TABLE IF NOT EXISTS ticket_feedback (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    original_subject TEXT NOT NULL DEFAULT '',
    corrected_subject TEXT NOT NULL DEFAULT '',
    original_description TEXT NOT NULL DEFAULT '',
    corrected_description TEXT NOT NULL DEFAULT '',
    original_resolution TEXT NOT NULL DEFAULT '',
    corrected_resolution TEXT NOT NULL DEFAULT '',
    corrected_fields_json TEXT NOT NULL DEFAULT '[]',
    what_ai_missed TEXT NOT NULL DEFAULT '',
    resolution_worked INTEGER,
    style_example_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ticket_feedback_ticket ON ticket_feedback(ticket_id)`,

  // ── Reminders (Phase 3) ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    ticket_id TEXT,
    store_number TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    snooze_until TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reminders_due_at ON reminders(due_at)`,

  // ── Settings table (Phase 1 keeps localStorage; table exists for Phase 3) ──
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  // ── Knowledge items (Phase 3) ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(type)`,
];
