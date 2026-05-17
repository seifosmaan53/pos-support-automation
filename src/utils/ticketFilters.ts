import type { SavedTicket, TicketResult } from "../types/ticket";
import { EXTRACTION_SOURCE_VERSION } from "../types/ticket";
import { audioFilesStore } from "../services/audioFilesStore";

export type TriState = "any" | "yes" | "no";

export interface HistoryFilters {
  storeNumber: string;
  result: "" | TicketResult;
  category: string;
  subCategory: string;
  dateFrom: string;
  dateTo: string;
  hasAudio: TriState;
  hasSpeakerTranscript: TriState;
  hasCorrectionAudit: TriState;
  hasPartRequest: TriState;
  hasNameCorrection: TriState;
  extractorVersion: "any" | "current" | "older" | "legacy";
  reviewed: TriState;
}

export const DEFAULT_FILTERS: HistoryFilters = {
  storeNumber: "",
  result: "",
  category: "",
  subCategory: "",
  dateFrom: "",
  dateTo: "",
  hasAudio: "any",
  hasSpeakerTranscript: "any",
  hasCorrectionAudit: "any",
  hasPartRequest: "any",
  hasNameCorrection: "any",
  extractorVersion: "any",
  reviewed: "any",
};

/**
 * Returns true when the ticket has an audio recording AND the recording has
 * not been soft-deleted. Reaches into `audioFilesStore` so the History
 * filter and badge agree with what Inspect actually shows.
 */
export function hasAudio(t: SavedTicket): boolean {
  if (!t.audioId) return false;
  const audio = audioFilesStore.get(t.audioId);
  return !!audio && !audio.deleted;
}

/**
 * Returns true when audio was attached to this ticket at some point but has
 * since been deleted. Distinguishes "never had audio" from "had audio,
 * removed it" so History can show a clear "Audio deleted" badge.
 */
export function audioWasDeleted(t: SavedTicket): boolean {
  if (!t.audioId) return false;
  const audio = audioFilesStore.get(t.audioId);
  return !!audio && audio.deleted;
}

export function hasSpeakerTranscript(t: SavedTicket): boolean {
  return (t.speakerSegments?.length ?? 0) > 0;
}

export function hasCorrectionAudit(t: SavedTicket): boolean {
  return (
    (t.approvedCorrections?.length ?? 0) > 0 ||
    (t.undoneCorrections?.length ?? 0) > 0 ||
    (t.userCorrectedSpeakerSegments?.length ?? 0) > 0
  );
}

export function hasPartRequest(t: SavedTicket): boolean {
  if (t.details.partNeeded) return true;
  if ((t.details.partRequest ?? "").trim().length > 0) return true;
  if ((t.ticketFields?.partRequest ?? "").trim().length > 0) return true;
  if ((t.details.parts?.length ?? 0) > 0) return true;
  return false;
}

export function hasNameCorrection(t: SavedTicket): boolean {
  return (t.nameCorrectionsApplied?.length ?? 0) > 0;
}

export type ExtractorAge = "current" | "older" | "legacy";

/**
 * Empty string ⇒ ticket pre-dates the audit-trail field, classified as
 * "legacy". Non-empty mismatch ⇒ generated under a previous analyzer version
 * and tagged "older" so the user knows re-running may produce different
 * results. Match ⇒ "current" (no badge needed in lists, but the inspect view
 * still shows it for clarity).
 */
export function extractorAge(t: SavedTicket): ExtractorAge {
  const v = t.extractionSourceVersion;
  if (!v) return "legacy";
  if (v === EXTRACTION_SOURCE_VERSION) return "current";
  return "older";
}

function triStateMatches(state: TriState, actual: boolean): boolean {
  if (state === "any") return true;
  return state === "yes" ? actual : !actual;
}

/**
 * Apply every active filter to a ticket. Empty / "any" filter values are
 * skipped so adding a new filter dimension never silently removes results.
 */
export function ticketMatchesFilters(t: SavedTicket, f: HistoryFilters): boolean {
  if (f.storeNumber) {
    const want = f.storeNumber.replace(/\D+/g, "").toLowerCase();
    const have = (t.details.storeNumber ?? "").replace(/^0+/, "").toLowerCase();
    const haveRaw = (t.details.storeNumber ?? "").toLowerCase();
    if (!have.includes(want.replace(/^0+/, "")) && !haveRaw.includes(want)) return false;
  }
  if (f.result && t.details.result !== f.result) return false;
  if (
    f.category &&
    !(t.details.category ?? "").toLowerCase().includes(f.category.toLowerCase())
  ) {
    return false;
  }
  if (
    f.subCategory &&
    !(t.details.subCategory ?? "")
      .toLowerCase()
      .includes(f.subCategory.toLowerCase())
  ) {
    return false;
  }
  if (f.dateFrom) {
    if (t.createdAt.slice(0, 10) < f.dateFrom) return false;
  }
  if (f.dateTo) {
    if (t.createdAt.slice(0, 10) > f.dateTo) return false;
  }
  if (!triStateMatches(f.hasAudio, hasAudio(t))) return false;
  if (!triStateMatches(f.hasSpeakerTranscript, hasSpeakerTranscript(t))) return false;
  if (!triStateMatches(f.hasCorrectionAudit, hasCorrectionAudit(t))) return false;
  if (!triStateMatches(f.hasPartRequest, hasPartRequest(t))) return false;
  if (!triStateMatches(f.hasNameCorrection, hasNameCorrection(t))) return false;
  if (!triStateMatches(f.reviewed, !!t.reviewed)) return false;
  if (f.extractorVersion !== "any" && extractorAge(t) !== f.extractorVersion) return false;
  return true;
}

/**
 * Check if any filter is active so the UI can render a "Clear filters"
 * affordance only when it would actually do something.
 */
export function isAnyFilterActive(f: HistoryFilters): boolean {
  return (
    f.storeNumber !== "" ||
    f.result !== "" ||
    f.category !== "" ||
    f.subCategory !== "" ||
    f.dateFrom !== "" ||
    f.dateTo !== "" ||
    f.hasAudio !== "any" ||
    f.hasSpeakerTranscript !== "any" ||
    f.hasCorrectionAudit !== "any" ||
    f.hasPartRequest !== "any" ||
    f.hasNameCorrection !== "any" ||
    f.extractorVersion !== "any" ||
    f.reviewed !== "any"
  );
}
