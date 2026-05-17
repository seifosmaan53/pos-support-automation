/**
 * Phase 12B — re-extract a saved ticket against the current analyzer +
 * writing layer without disturbing the workflow state.
 *
 * "Do not overwrite original data" — the spec is satisfied because:
 *   • `rawTranscript` and `correctedTranscript` are never modified.
 *   • `transcriptVersions` are append-only (handled elsewhere).
 *   • Only the derived `details`, `summaries`, `ticketFields`,
 *     `extractionSourceVersion`, and `extractionTimestamp` change.
 *
 * A "version" in this context means a fresh derivation — the source of
 * truth (the transcript) is intact, so the user can always re-extract
 * again and compare via History → Audit.
 */
import { analyzeWithAI } from "./aiService";
import { generateAllSummaries } from "./summaryGenerator";
import { generateTicketFields } from "./ticketFieldGenerator";
import { ticketStore } from "./databaseService";
import { logError } from "./errorLog";
import type { AppSettings } from "../types/settings";
import {
  EXTRACTION_SOURCE_VERSION,
  type SavedTicket,
} from "../types/ticket";

export interface ReExtractResult {
  ticketId: string;
  ok: boolean;
  message: string;
  newExtractionVersion: string;
}

/**
 * Re-run the analyzer + writing layer over a saved ticket's raw transcript
 * and persist the updated ticket. Returns a small status object so the
 * caller can show per-ticket success / failure in a batch.
 */
export async function reExtractSavedTicket(
  id: string,
  settings: AppSettings,
): Promise<ReExtractResult> {
  const existing = ticketStore.get(id);
  if (!existing) {
    return {
      ticketId: id,
      ok: false,
      message: "Ticket not found.",
      newExtractionVersion: "",
    };
  }
  const transcript = existing.rawTranscript || existing.transcript || "";
  if (!transcript.trim()) {
    return {
      ticketId: id,
      ok: false,
      message: "Ticket has no raw transcript to re-extract from.",
      newExtractionVersion: existing.extractionSourceVersion,
    };
  }
  try {
    const result = await analyzeWithAI(transcript, settings);
    const details = result.value;
    const summaries = generateAllSummaries({
      transcript,
      details,
      cleanedTranscript: result.cleanedTranscript ?? transcript,
      writingStyle: settings.writingStyle,
    });
    const ticketFields = generateTicketFields({
      details,
      technicianName: settings.technicianName,
      writingStyle: settings.writingStyle,
    });
    const updated: SavedTicket = {
      ...existing,
      details,
      summaries,
      ticketFields,
      extractionSourceVersion: EXTRACTION_SOURCE_VERSION,
      extractionTimestamp: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Original `rawTranscript` / `correctedTranscript` / `audioId` /
      // `transcriptVersions` are preserved by spread above.
    };
    ticketStore.upsert(updated);
    return {
      ticketId: id,
      ok: true,
      message: "Re-extracted.",
      newExtractionVersion: EXTRACTION_SOURCE_VERSION,
    };
  } catch (e) {
    const msg = (e as Error).message;
    logError({
      source: "ai",
      op: `reExtract(${id})`,
      message: msg,
    });
    return {
      ticketId: id,
      ok: false,
      message: msg,
      newExtractionVersion: existing.extractionSourceVersion,
    };
  }
}

export function listOlderExtractorTickets(): SavedTicket[] {
  return ticketStore
    .list()
    .filter(
      (t) =>
        !t.extractionSourceVersion ||
        t.extractionSourceVersion !== EXTRACTION_SOURCE_VERSION,
    );
}
