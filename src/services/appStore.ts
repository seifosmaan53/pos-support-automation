import { create } from "zustand";
import {
  EMPTY_DETAILS,
  EMPTY_SUMMARIES,
  EMPTY_TICKET_FIELDS,
  EXTRACTION_SOURCE_VERSION,
  type DetailLevel,
  type ExtractedDetails,
  type SavedCorrectionChange,
  type SavedNameCorrection,
  type SavedSpeakerSegment,
  type SavedTicket,
  type SummarySet,
  type SummaryVariant,
  type TicketFields,
} from "../types/ticket";
import type { AppSettings } from "../types/settings";
import { settingsStore, ticketStore } from "./databaseService";
import { audioFilesStore } from "./audioFilesStore";
import { ticketFeedbackStore } from "./ticketFeedbackStore";
import { styleExamplesStore } from "./styleExamplesStore";
import { remindersStore } from "./remindersStore";
import type { Reminder } from "../types/reminder";
import { knowledgeStore } from "./knowledgeStore";
import type {
  AnyKnowledgeItem,
  KnowledgeContentByType,
  KnowledgeItem,
  KnowledgeItemType,
} from "../types/knowledge";
import type { CopyableFieldKey, CopyLogEntry } from "../types/copyMode";
import {
  applyLiveAssistAnswersToDetails,
  applyLiveAssistAnswersToFields,
  type LiveAssistAnswerKind,
  type LiveAssistAnswers,
} from "../types/liveAssist";
import { deriveLearnedPattern, EXTRACTION_KIND_LABELS } from "../types/extractionPattern";
import { extractionPatternsStore } from "./extractionPatternsStore";
import type { StartupWarning } from "./startupSafety";
import { markRcSignal } from "./releaseChecklist";
import { recordPilotEvent } from "./pilotMode";
import type { TranscriptVersion } from "../types/audio";
import type {
  CorrectableField,
  FieldCorrection,
  ResolutionStatus,
  TicketFeedback,
} from "../types/feedback";
import type { StyleExample } from "../types/styleExample";
import { analyzeWithAI, generateWithAI, type AISource } from "./aiService";
import { newId, nowIso } from "../utils/formatDate";
import { blobToWav16kMono } from "./audioEncoder";
import { classifyLiveChunkText } from "./liveAudioTextFilter";
import {
  LiveChunkRecorder,
  type ChunkPayload,
  type FinalRecording,
} from "./liveChunkRecorder";
import {
  EMPTY_LIVE_CAPTURE,
  buildLiveTranscript,
  type LiveCaptureState,
  type LiveSegment,
} from "../types/live";
import {
  deleteAudioFile,
  importAudioFile,
  isPersistenceAvailable,
  readAudioFile,
  saveAudioFile,
} from "./audioStorage";
import { friendlyWhisperError, transcribeAudio } from "./whisperService";
import { generateAllSummaries } from "./summaryGenerator";
import { generateTicketFields } from "./ticketFieldGenerator";
import {
  applyAlternatingSpeakers,
  applyBulkSpeakerCorrection,
  applySpeakerCorrection,
  classifyWithContext,
  detectSpeakers,
  type PrevSegmentHint,
} from "./speakerDetector";
import { correctTranscript, type CorrectionChange } from "./transcriptCorrector";
import { detectCallerNameInSequence } from "./callerNameDetector";
import type { SpeakerLabel, SpeakerSegment } from "../types/speaker";
import { runSelfReview } from "./confidenceScorer";
import { EMPTY_SELF_REVIEW, type SelfReviewResult } from "../types/confidence";

export type Stage =
  | "idle"
  | "transcript"
  | "review"
  | "details"
  | "form"
  | "ticket";

type StatusKind = "info" | "success" | "warning" | "error";

export type AudioStatus =
  | "idle"
  | "recording"
  | "paused"
  | "encoding"
  | "ready"
  | "transcribing"
  | "error";

export interface AudioState {
  status: AudioStatus;
  blobUrl: string | null;
  blobMimeType: string | null;
  durationMs: number;
  wavPath: string | null;
  isPersisted: boolean;
  errorMessage: string | null;
  recordingStartedAt: number | null;
  pausedAt: number | null;
  totalPausedMs: number;
}

// Phase 16 — persist dismissed startup-banner ids across launches.
// Each id may embed a fingerprint (e.g. "audio-files-missing:3") so that a
// dismissal naturally expires when the underlying state changes.
const LS_DISMISSED_STARTUP_KEY = "sta.startup_warnings.dismissed.v1";

function readDismissedStartupWarnings(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_DISMISSED_STARTUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function writeDismissedStartupWarnings(list: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Cap at 100 so a runaway "warning rotates fingerprints every minute"
    // bug couldn't bloat localStorage forever.
    const trimmed = list.slice(-100);
    localStorage.setItem(LS_DISMISSED_STARTUP_KEY, JSON.stringify(trimmed));
  } catch {
    // best-effort
  }
}

const EMPTY_AUDIO: AudioState = {
  status: "idle",
  blobUrl: null,
  blobMimeType: null,
  durationMs: 0,
  wavPath: null,
  isPersisted: false,
  errorMessage: null,
  recordingStartedAt: null,
  pausedAt: null,
  totalPausedMs: 0,
};

interface AppState {
  settings: AppSettings;
  stage: Stage;
  transcript: string;
  cleanedTranscript: string;
  corrections: CorrectionChange[];
  /** Corrections the user has accepted (or that are auto-apply). */
  approvedCorrections: CorrectionChange[];
  /** Corrections the user has chosen to undo. Persists across re-corrections. */
  undoneCorrections: CorrectionChange[];
  /** Detected→corrected name substitutions that fired during the current run. */
  nameCorrectionsApplied: SavedNameCorrection[];
  speakerSegments: SpeakerSegment[];
  selfReview: SelfReviewResult;
  details: ExtractedDetails;
  detailLevel: DetailLevel;
  generatedTicket: string;
  summaries: SummarySet;
  ticketFields: TicketFields;
  selectedSummary: SummaryVariant;
  currentTicketId: string | null;
  status: { kind: StatusKind; message: string } | null;
  busy: "analyzing" | "generating" | null;
  audio: AudioState;
  /** Phase 11A — chunked live capture state. Volatile per-session; cleared
   *  once the user accepts a transcript or workflow resets. */
  liveCapture: LiveCaptureState;
  /** Phase 12 — non-blocking warnings computed at boot. Dismissed individually. */
  startupWarnings: StartupWarning[];
  /** Ids of startupWarnings the user has dismissed this session. */
  dismissedStartupWarnings: string[];

  setTranscript: (t: string) => void;
  analyzeCurrentTranscript: () => Promise<void>;
  setDetails: (d: ExtractedDetails) => void;
  patchDetails: (patch: Partial<ExtractedDetails>) => void;
  setDetailLevel: (level: DetailLevel) => void;
  generate: (override?: { detailLevel?: DetailLevel }) => Promise<void>;
  setGeneratedTicket: (text: string) => void;
  regenerateFromDetails: () => void;
  patchTicketFields: (patch: Partial<TicketFields>) => void;
  setSelectedSummary: (v: SummaryVariant) => void;
  resetTicketFields: () => void;
  /**
   * Persist the in-memory ticket draft. By default, any local recording is
   * auto-attached. Pass `{ attachAudio: false }` from the unattached-audio
   * confirm dialog when the user explicitly chooses "Save Without Recording".
   */
  saveCurrentTicket: (options?: { attachAudio?: boolean }) => SavedTicket | null;
  /**
   * Replace the currently-attached audio_files row with the fresh in-memory
   * recording. Marks the old row deleted (so History → Audio still shows
   * "Audio deleted") and creates a new row linked to the same ticket.
   * Requires both: a current ticket with an audioId AND a persisted local
   * recording with a wavPath.
   */
  replaceAudioOnCurrentTicket: () => boolean;
  /**
   * Phase 11D — copy a user-chosen audio file into the app's audio
   * directory and link it to the current ticket. Saves the ticket first
   * if it isn't saved yet. Supported extensions: wav / mp3 / m4a / webm /
   * ogg. Returns true on success.
   */
  attachExistingRecording: (sourcePath: string) => Promise<boolean>;
  markReviewed: () => void;
  loadTicket: (id: string) => void;
  resetWorkflow: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  /**
   * Phase 16 fix — reload settings from settingsStore into the in-memory
   * appStore. Used by Restore Backup paths that write to localStorage
   * directly via settingsStore.save(); without this, every consumer of
   * useAppStore((s) => s.settings) sees the old values until reload.
   */
  reloadSettings: () => void;
  setStatus: (status: AppState["status"]) => void;
  setStartupWarnings: (warnings: StartupWarning[]) => void;
  appendStartupWarning: (warning: StartupWarning) => void;
  dismissStartupWarning: (id: string) => void;

  setSpeakerLabel: (segmentId: string, speaker: SpeakerLabel) => void;
  bulkSetSpeakerLabels: (segmentIds: string[], speaker: SpeakerLabel) => void;
  alternateSpeakers: (firstSpeaker: SpeakerLabel) => void;
  saveSpeakerCorrections: () => void;
  saveNameCorrection: (detected: string, corrected: string) => void;
  applyNameCorrection: (corrected: string) => void;
  recordCorrectionResolution: (
    approved: CorrectionChange[],
    undone: CorrectionChange[],
  ) => void;
  reanalyzeFromSavedSpeakerTranscript: () => Promise<void>;
  reanalyzeFromOriginalRawTranscript: () => Promise<void>;
  rerunSelfReview: () => void;
  reanalyzeWithSpeakerCorrections: () => Promise<void>;

  // Phase 3: audio + transcript versioning ───────────────────────────────
  /**
   * Re-run whisper.cpp on the audio linked to a saved ticket. Appends a
   * new TranscriptVersion to the ticket; never overwrites the original or
   * deletes the audio. Returns the new version on success.
   */
  retranscribeTicketAudio: (ticketId: string) => Promise<TranscriptVersion | null>;
  /**
   * Apply a chosen transcript (existing version or edited text) to a saved
   * ticket: loads the ticket as the current workflow ticket, replaces the
   * transcript, re-runs analysis + field generation, and saves. Edited text
   * is recorded as a new "edited" TranscriptVersion before re-extraction.
   */
  applyTranscriptVersionToTicket: (
    ticketId: string,
    transcriptText: string,
    source: "existing" | "edited",
  ) => Promise<void>;
  /**
   * Soft-delete the audio recording linked to a ticket: removes the file on
   * disk, marks the audio_files row deleted=true, and stamps the ticket
   * with audioId=null so History reflects the deletion. Ticket is preserved.
   */
  deleteTicketAudio: (ticketId: string) => Promise<void>;

  // ── Phase 4: Correction Learning ─────────────────────────────────────
  /**
   * Capture a correction the user made to a generated field. Saves the
   * before/after pair on a fresh `ticket_feedback` row (or appends to the
   * latest row if it's still being filled out). Returns the saved feedback.
   */
  recordFieldCorrection: (
    field: CorrectableField,
    before: string,
    after: string,
    note?: string,
  ) => TicketFeedback | null;
  /**
   * Mark "AI missed: ..." with optional field/correctValue. Saves to the
   * ticket's feedback row and lets the caller optionally promote it into a
   * Saved Name Correction or knowledge rule from the UI.
   */
  recordAIMissed: (
    note: string,
    field?: CorrectableField,
    correctValue?: string,
  ) => TicketFeedback | null;
  /** Set whether the resolution worked. Persists on the ticket's feedback row. */
  setResolutionStatus: (status: ResolutionStatus) => TicketFeedback | null;
  /**
   * Capture the current ticket as a new Style Example. Returns the saved
   * example so the caller can link it back to the feedback row.
   */
  saveCurrentTicketAsStyleExample: (overrides?: {
    title?: string;
    notes?: string;
  }) => StyleExample | null;

  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => Promise<void>;
  cancelRecording: () => void;
  deleteAudio: () => Promise<void>;
  transcribeRecording: () => Promise<void>;
  /**
   * Adopt an on-disk WAV that has no SQLite `audio_files` row (an "orphan"
   * recording — typically left behind when the user recorded but never saved
   * the ticket). The file is loaded into the audio state exactly like a
   * fresh stop-recording would: status="ready", isPersisted=true, blobUrl
   * pointing at the file's bytes. From there the normal "Save Ticket" flow
   * will create the audio_files row and link it to the next ticket.
   */
  loadOrphanedRecording: (path: string, durationMs?: number) => Promise<void>;

  // ── Phase 11A: Live capture review ────────────────────────────────────
  /** Commit the live (chunked) transcript as the canonical transcript for analysis. */
  acceptLiveTranscript: () => void;
  /** Commit the final (post-stop full-recording) transcript for analysis. */
  acceptFinalTranscript: () => void;
  /** Commit an edited transcript draft from the Final Review card. */
  acceptEditedTranscript: (text: string) => void;
  /** Manual speaker correction on one live segment. Locks the segment so re-runs don't undo it. */
  setLiveSegmentSpeaker: (segmentId: string, speaker: SpeakerLabel) => void;
  /** Re-classify all non-user-corrected live segments using `classifyWithContext`. */
  rerunLiveSpeakerDetection: () => void;
  /** Force the LiveAssist preview analyzer to re-run on the current live transcript. */
  rerunLiveExtraction: () => void;
  /** Drop live-capture state (segments, liveTranscript, finalTranscript). Used by the review card. */
  clearLiveCapture: () => void;
  /**
   * Manually set (or clear, by passing "") the caller's name. Flips
   * `callerNameUserCorrected` to true so the live auto-detector won't
   * overwrite it on subsequent chunks.
   */
  setLiveCallerName: (name: string) => void;
  /**
   * Replace one segment's repaired text. Pins the segment (textEdited=true)
   * so the next chunk doesn't churn it; re-derives `liveTranscript`.
   */
  setLiveSegmentText: (segmentId: string, text: string) => void;
  /** Toggle the "important" flag on a segment. Pure UI; persisted with the ticket. */
  toggleLiveSegmentImportant: (segmentId: string) => void;
  /** Toggle the "wrong transcription" flag. Surfaces a warning in the review card. */
  toggleLiveSegmentWrong: (segmentId: string) => void;
  /**
   * Persist the Final Review edit-buffer back into `liveCapture.liveTranscript`
   * (and clear segments — the edit is now the canonical preview text). Keeps
   * the review status so the user can still re-run extraction / speaker
   * detection or commit. Does not change the saved audio or the original
   * raw chunks.
   */
  saveUpdatedTranscript: (text: string) => void;
  /**
   * Undo all transcript corrections applied to one segment by restoring the
   * raw whisper output. Sets `textEdited=true` so the segment is pinned and
   * future automatic re-processing won't re-apply the same repairs.
   */
  revertLiveSegmentCorrections: (segmentId: string) => void;

  // ── Phase 6: Reminders ─────────────────────────────────────────────────
  /**
   * Persist a reminder linked (when possible) to the current ticket. If the
   * ticket isn't saved yet, save it first so the reminder has something to
   * point at — matches the Phase 4 correction flow. Returns the saved row.
   */
  createReminder: (input: {
    title: string;
    message: string;
    dueAt?: string;
    storeNumber?: string;
    ticketId?: string | null;
  }) => Reminder | null;
  /** Mark a reminder completed and stamp completedAt. */
  completeReminder: (id: string) => Reminder | undefined;
  /** Snooze a reminder. `untilIso` is the ISO time the snooze elapses. */
  snoozeReminder: (id: string, untilIso: string) => Reminder | undefined;
  /** Dismiss a reminder (status=dismissed; no auto-resume). */
  dismissReminder: (id: string) => Reminder | undefined;
  /** Permanently delete a reminder row. */
  deleteReminder: (id: string) => void;
  /** Reopen a snoozed/completed/dismissed reminder. */
  reopenReminder: (id: string) => Reminder | undefined;
  /** Generic update — used by the page when the user edits inline. */
  updateReminder: (id: string, patch: Partial<Reminder>) => Reminder | undefined;
  /** Auto-resume snoozed reminders whose snooze window has elapsed. Called
   *  from the banner timer. Returns count for status messaging. */
  resumeExpiredReminderSnoozes: () => number;

  // ── Phase 7: Knowledge Base ────────────────────────────────────────────
  /** Create a knowledge item with the given type and partial content. */
  createKnowledgeItem: <T extends KnowledgeItemType>(input: {
    type: T;
    title: string;
    content?: Partial<KnowledgeContentByType[T]>;
  }) => KnowledgeItem<T> | null;
  /** Update an existing item by id. Returns the new row or undefined. */
  updateKnowledgeItem: <T extends KnowledgeItemType>(
    id: string,
    patch: { title?: string; content?: Partial<KnowledgeContentByType[T]> },
  ) => KnowledgeItem<T> | undefined;
  /** Replace the entire item record. */
  upsertKnowledgeItem: (item: AnyKnowledgeItem) => AnyKnowledgeItem;
  /** Permanently delete a knowledge item. */
  deleteKnowledgeItem: (id: string) => void;
  /**
   * Capture the current workflow ticket (or a referenced ticket) as a
   * knowledge item. Saves the workflow ticket first if needed so the
   * relatedTicketIds link points at a real row. Returns the saved item.
   */
  createKnowledgeFromTicket: <T extends KnowledgeItemType>(input: {
    type: T;
    title?: string;
    ticketId?: string;
    content?: Partial<KnowledgeContentByType[T]>;
  }) => KnowledgeItem<T> | null;

  // ── Phase 9: Copy Mode ─────────────────────────────────────────────────
  /** Whether the user is currently in Copy Mode. Used by KeyboardShortcutsHandler
   *  so the global Cmd/Ctrl+Shift+C handler can yield to the per-field one. */
  copyModeActive: boolean;
  setCopyModeActive: (active: boolean) => void;
  /** Append a copy event for the named field. Saves the workflow ticket if needed. */
  recordFieldCopied: (field: CopyableFieldKey, value: string) => CopyLogEntry | null;
  /** Mark the current ticket's copy sequence as fully completed. */
  markCopySequenceCompleted: () => void;
  /** Reset the copy log on the current ticket — used by the "Reset Sequence" button. */
  resetCopyLog: () => void;

  // ── Phase 10A: Live Assist inline answers ─────────────────────────────
  /** Answers the user typed inline against Missing alerts, keyed by kind. */
  liveAssistAnswers: LiveAssistAnswers;
  /** Set / overwrite a single inline answer. Empty value clears it. */
  setLiveAssistAnswer: <K extends LiveAssistAnswerKind>(
    kind: K,
    value: LiveAssistAnswers[K] | "",
  ) => void;
  /** Drop all pending answers (e.g. on workflow reset). */
  clearLiveAssistAnswers: () => void;
}

let activeLiveRecorder: LiveChunkRecorder | null = null;

/**
 * Module-level accessor for the active recording's MediaStream. Used by the
 * audio-level meter component so it can attach an AnalyserNode without
 * spawning a second getUserMedia call. Returns null when not recording.
 */
export function getActiveMediaStream(): MediaStream | null {
  return activeLiveRecorder?.getMediaStream() ?? null;
}

/**
 * Prefixes the speaker detector recognizes via `explicitSpeakerLabel`. When we
 * rebuild a transcript from saved speaker segments, we emit these so a fresh
 * detection pass returns the exact same labels — no heuristic needed.
 */
const SPEAKER_PREFIX_FOR: Record<SpeakerLabel, string> = {
  tech_support: "Tech Support",
  store_employee: "Store Employee",
  store_manager: "Store Manager",
  vendor: "Vendor",
  customer: "Customer",
  wrong_caller: "Wrong Caller",
  unknown: "Speaker",
};

/**
 * Merge a fresh detection pass with prior user corrections. Detection produces
 * fresh segment IDs every run (they include a random suffix), so we match by
 * the segment text. Anything the user explicitly labeled wins over detection.
 */
/**
 * Map a CorrectionChange back to a stable lookup key the corrector can match
 * in its `excludeFromForms` set. Domain rules expose themselves via their
 * arrow label (e.g. "story → store"), so we synthesize the same form here.
 */
function deriveExclusionKey(c: CorrectionChange): string {
  if (c.source === "domain") return `${c.from} → ${c.to}`;
  return c.from;
}

/**
 * After detection, attach `originalText` to each segment using the corrector's
 * change list. We can't always recover the exact pre-repair text per segment
 * (the corrector ran on the whole transcript), but for any segment whose
 * cleaned text contains a `to` substring, we can reconstruct the original by
 * substituting the matching `from` back. Segments that weren't touched keep
 * `originalText === text`, which is what the editor expects.
 */
function mergeOriginalsIntoSegments(
  segments: SpeakerSegment[],
  changes: CorrectionChange[],
): SpeakerSegment[] {
  if (changes.length === 0) return segments;
  return segments.map((s) => {
    let original = s.text;
    for (const c of changes) {
      const idx = original.toLowerCase().indexOf(c.to.toLowerCase());
      if (idx >= 0) {
        original = original.slice(0, idx) + c.from + original.slice(idx + c.to.length);
      }
    }
    return { ...s, originalText: original };
  });
}

function mergeUserCorrections(
  fresh: SpeakerSegment[],
  userCorrected: SpeakerSegment[],
): SpeakerSegment[] {
  return fresh.map((f) => {
    const match = userCorrected.find((u) => u.text.trim() === f.text.trim());
    return match
      ? { ...f, speaker: match.speaker, confidence: "high" as const, userCorrected: true }
      : f;
  });
}

/**
 * Apply saved name corrections to the freshly extracted details. When the
 * detected name matches a previously-saved hint, replace it with the canonical
 * form and append a confidence note recording the substitution. The underlying
 * `needsReview` warning from extraction (if any) is preserved — the user just
 * confirmed the spelling once, not forever.
 */
function applyNameHint(
  details: ExtractedDetails,
  hints: AppSettings["nameCorrections"],
): { details: ExtractedDetails; applied: SavedNameCorrection | null } {
  if (!details.callerName || hints.length === 0)
    return { details, applied: null };
  const detected = details.callerName.trim().toLowerCase();
  const match = hints.find((h) => h.detected === detected);
  if (!match || match.corrected === details.callerName)
    return { details, applied: null };
  const noteAlreadyPresent = details.confidenceNotes?.some((n) =>
    n.includes("name hint"),
  );
  const note = noteAlreadyPresent
    ? null
    : `Caller name "${details.callerName}" was replaced with saved name hint "${match.corrected}". Confirm with the caller if the spelling is critical.`;
  return {
    details: {
      ...details,
      callerName: match.corrected,
      contactName:
        details.contactName === details.callerName ? match.corrected : details.contactName,
      requesterName:
        details.requesterName === details.callerName ? match.corrected : details.requesterName,
      confidenceNotes: note
        ? [...(details.confidenceNotes ?? []), note]
        : details.confidenceNotes,
    },
    applied: { detected: details.callerName, corrected: match.corrected },
  };
}

function revokeUrl(url: string | null): void {
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

function statusMessageForSource(
  source: AISource,
  ollamaModel: string,
): string {
  if (source === "ollama") return `Analyzed with local AI (${ollamaModel}).`;
  if (source === "lmstudio") return "Analyzed with LM Studio.";
  return "Analyzed with rule-based extractor.";
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: settingsStore.load(),
  stage: "idle",
  transcript: "",
  cleanedTranscript: "",
  corrections: [],
  approvedCorrections: [],
  undoneCorrections: [],
  nameCorrectionsApplied: [],
  speakerSegments: [],
  selfReview: { ...EMPTY_SELF_REVIEW },
  details: { ...EMPTY_DETAILS },
  detailLevel: settingsStore.load().defaultDetailLevel,
  generatedTicket: "",
  summaries: { ...EMPTY_SUMMARIES },
  ticketFields: { ...EMPTY_TICKET_FIELDS },
  liveAssistAnswers: {} as LiveAssistAnswers,
  selectedSummary: "normal",
  currentTicketId: null,
  status: null,
  busy: null,
  audio: { ...EMPTY_AUDIO },
  liveCapture: { ...EMPTY_LIVE_CAPTURE },
  startupWarnings: [],
  dismissedStartupWarnings: readDismissedStartupWarnings(),

  setTranscript: (t) => {
    const settings = get().settings;
    // Carry the user's prior undone-correction choices forward so the
    // corrector doesn't re-fire rules they explicitly opted out of.
    const undoneForms = new Set(
      get().undoneCorrections.map((c) =>
        deriveExclusionKey(c).trim().toLowerCase(),
      ),
    );
    const correction = t.trim()
      ? correctTranscript(t, {
          dictionary: settings.correctionDictionary,
          applyDictionary: settings.enableTranscriptCorrection !== false,
          applyNumberWords: settings.enableNumberWordNormalization !== false,
          applyDomainRepair: true,
          excludeFromForms: undoneForms,
        })
      : { text: "", changes: [] };
    const speakerSegments = correction.text
      ? mergeOriginalsIntoSegments(detectSpeakers(correction.text), correction.changes)
      : [];
    set({
      transcript: t,
      cleanedTranscript: correction.text,
      corrections: correction.changes,
      // Auto-apply changes default to approved on initial paste; the user can
      // flip them to undone via the Correction Review.
      approvedCorrections: correction.changes.filter((c) => c.autoApply),
      // Preserve undone choices across re-corrections so they remain in the
      // ticket's audit trail even when the trigger phrase no longer survives
      // in the cleaned text.
      undoneCorrections: get().undoneCorrections,
      nameCorrectionsApplied: [],
      stage: t.trim() ? "transcript" : "idle",
      speakerSegments,
    });
  },

  analyzeCurrentTranscript: async () => {
    const { transcript, settings } = get();
    if (!transcript.trim()) {
      set({ status: { kind: "warning", message: "Add a transcript first." } });
      return;
    }
    set({
      busy: "analyzing",
      status: {
        kind: "info",
        message:
          settings.aiProvider === "ollama"
            ? `Analyzing with local AI (${settings.ollamaModel})…`
            : settings.aiProvider === "lmstudio"
              ? "Analyzing with LM Studio…"
              : "Analyzing transcript…",
      },
    });
    try {
      const result = await analyzeWithAI(transcript, settings);
      // Re-run speaker detection on the *cleaned* transcript so labels reflect
      // the same text the extraction logic saw. If the user already corrected
      // labels (userCorrected=true), preserve their corrections.
      const cleanedForSpeakers = result.cleanedTranscript ?? transcript;
      const detected = detectSpeakers(cleanedForSpeakers);
      const prevCorrections = get().speakerSegments.filter((s) => s.userCorrected);
      const speakerSegments =
        prevCorrections.length > 0 ? mergeUserCorrections(detected, prevCorrections) : detected;
      // Apply any saved name-correction hints. If the analyzer surfaced a name
      // that matches a previously-saved detected→corrected mapping, swap it
      // and append a note that the value came from a saved hint rather than
      // suppressing the existing review warning — the transcript still says
      // the misheard form, so the audit trail remains accurate.
      const { details: detailsWithNameHint, applied: nameHintApplied } = applyNameHint(
        result.value,
        settings.nameCorrections,
      );
      const summaries = generateAllSummaries({
        transcript,
        details: detailsWithNameHint,
        cleanedTranscript: result.cleanedTranscript,
        writingStyle: settings.writingStyle,
      });
      const ticketFields = generateTicketFields({
        details: detailsWithNameHint,
        technicianName: settings.technicianName,
        writingStyle: settings.writingStyle,
      });
      const selfReview = runSelfReview({
        details: detailsWithNameHint,
        fields: ticketFields,
        speakerSegments,
        transcript,
      });
      // Phase 10A: re-apply any pending Live Assist inline answers as
      // overrides on top of the fresh analysis, so a manual answer the user
      // typed during the call always survives a re-analyze.
      const answers = get().liveAssistAnswers;
      const finalDetails = applyLiveAssistAnswersToDetails(detailsWithNameHint, answers);
      const finalFields = applyLiveAssistAnswersToFields(ticketFields, answers);
      set({
        details: finalDetails,
        cleanedTranscript: result.cleanedTranscript ?? transcript,
        corrections: result.corrections ?? [],
        nameCorrectionsApplied: nameHintApplied
          ? [...get().nameCorrectionsApplied.filter((n) => n.detected !== nameHintApplied.detected), nameHintApplied]
          : get().nameCorrectionsApplied,
        speakerSegments,
        selfReview,
        summaries,
        ticketFields: finalFields,
        stage: "details",
        status: result.warning
          ? { kind: "warning", message: result.warning }
          : {
              kind: "success",
              message: statusMessageForSource(result.source, settings.ollamaModel),
            },
      });
    } catch (e) {
      set({ status: { kind: "error", message: (e as Error).message } });
    } finally {
      set({ busy: null });
    }
  },

  setDetails: (d) => {
    const { transcript, cleanedTranscript, settings, speakerSegments } = get();
    const summaries = generateAllSummaries({
      transcript,
      details: d,
      cleanedTranscript,
      writingStyle: settings.writingStyle,
    });
    const ticketFields = generateTicketFields({
      details: d,
      technicianName: settings.technicianName,
      writingStyle: settings.writingStyle,
    });
    const selfReview = runSelfReview({
      details: d,
      fields: ticketFields,
      speakerSegments,
      transcript,
    });
    set({ details: d, summaries, ticketFields, selfReview });
  },

  patchDetails: (patch) =>
    set((s) => {
      const next = { ...s.details, ...patch };
      const summaries = generateAllSummaries({
        transcript: s.transcript,
        details: next,
        cleanedTranscript: s.cleanedTranscript,
        writingStyle: s.settings.writingStyle,
      });
      const ticketFields = generateTicketFields({
        details: next,
        technicianName: s.settings.technicianName,
        writingStyle: s.settings.writingStyle,
      });
      const selfReview = runSelfReview({
        details: next,
        fields: ticketFields,
        speakerSegments: s.speakerSegments,
        transcript: s.transcript,
      });
      return { details: next, summaries, ticketFields, selfReview };
    }),

  setDetailLevel: (level) => set({ detailLevel: level }),

  generate: async (override) => {
    const { details, settings } = get();
    const detailLevel = override?.detailLevel ?? get().detailLevel;
    set({
      detailLevel,
      busy: "generating",
      status: {
        kind: "info",
        message:
          settings.aiProvider === "ollama"
            ? `Generating with local AI (${settings.ollamaModel})…`
            : "Generating ticket…",
      },
    });
    try {
      const result = await generateWithAI(details, detailLevel, settings);
      set({
        generatedTicket: result.value,
        stage: "ticket",
        status: result.warning
          ? { kind: "warning", message: result.warning }
          : {
              kind: "success",
              message:
                result.source === "ollama"
                  ? "Generated with local AI."
                  : "Ticket generated.",
            },
      });
      if (settings.autoSaveOnGenerate) {
        get().saveCurrentTicket();
      }
    } catch (e) {
      set({ status: { kind: "error", message: (e as Error).message } });
    } finally {
      set({ busy: null });
    }
  },

  setGeneratedTicket: (text) => set({ generatedTicket: text }),

  regenerateFromDetails: () => {
    const { transcript, cleanedTranscript, details, settings, speakerSegments } = get();
    const summaries = generateAllSummaries({
      transcript,
      details,
      cleanedTranscript,
      writingStyle: settings.writingStyle,
    });
    const ticketFields = generateTicketFields({
      details,
      technicianName: settings.technicianName,
      writingStyle: settings.writingStyle,
    });
    const selfReview = runSelfReview({
      details,
      fields: ticketFields,
      speakerSegments,
      transcript,
    });
    set({
      summaries,
      ticketFields,
      selfReview,
      status: { kind: "success", message: "Ticket fields and summaries regenerated." },
    });
  },

  patchTicketFields: (patch) =>
    set((s) => ({ ticketFields: { ...s.ticketFields, ...patch } })),

  setSelectedSummary: (v) => set({ selectedSummary: v }),

  resetTicketFields: () => {
    const { details, settings } = get();
    const ticketFields = generateTicketFields({
      details,
      technicianName: settings.technicianName,
      writingStyle: settings.writingStyle,
    });
    set({
      ticketFields,
      status: { kind: "success", message: "Ticket fields reset to generated values." },
    });
  },

  saveCurrentTicket: (options) => {
    const attachAudio = options?.attachAudio !== false; // default true
    const {
      transcript,
      cleanedTranscript,
      details,
      generatedTicket,
      detailLevel,
      currentTicketId,
      settings,
      summaries,
      ticketFields,
      speakerSegments,
      corrections,
      approvedCorrections,
      undoneCorrections,
      nameCorrectionsApplied,
    } = get();
    if (settings.disableHistory) {
      set({
        status: {
          kind: "warning",
          message: "History is disabled in Settings — ticket was not saved.",
        },
      });
      return null;
    }
    const hasContent =
      generatedTicket.trim() ||
      ticketFields.subject.trim() ||
      ticketFields.description.trim();
    if (!hasContent) {
      set({
        status: {
          kind: "warning",
          message:
            "Nothing to save yet — add a transcript and analyze, or fill subject/description (or generate a ticket note).",
        },
      });
      return null;
    }
    const id = currentTicketId ?? newId();
    const existing = currentTicketId ? ticketStore.get(currentTicketId) : undefined;

    // Phase 3: link the in-memory recording to this ticket if one exists.
    // We never overwrite an existing audio_files row with a new path — if the
    // user re-records, that's a separate audio_files row pointing at a new
    // file, with the prior row left in place (deleted=true once cleaned up).
    const audio = get().audio;
    let audioId = existing?.audioId ?? null;
    if (attachAudio && audio.wavPath && audio.isPersisted && !audioId) {
      audioId = newId();
      audioFilesStore.upsert({
        id: audioId,
        ticketId: id,
        path: audio.wavPath,
        durationMs: audio.durationMs,
        format: "wav",
        createdAt: nowIso(),
        deleted: false,
        transcriptStatus: transcript.trim() ? "transcribed" : "pending",
      });
    }

    // Seed an "original" transcript version on first save so re-transcription
    // always has the baseline to compare against. Subsequent saves preserve
    // any later versions the user has appended.
    const priorVersions = existing?.transcriptVersions ?? [];
    const transcriptVersions: TranscriptVersion[] =
      priorVersions.length > 0
        ? priorVersions
        : transcript.trim()
          ? [
              {
                id: newId(),
                source: "original",
                text: transcript,
                createdAt: existing?.createdAt ?? nowIso(),
              },
            ]
          : [];

    const savedSegments: SavedSpeakerSegment[] = speakerSegments.map((s) => ({
      id: s.id,
      originalText: s.originalText ?? s.text,
      repairedText: s.text,
      speakerLabel: s.speaker,
      confidence: s.confidence,
      reason: s.reason ?? "",
      userCorrected: s.userCorrected,
      timestampStart: s.timestampStart || undefined,
      timestampEnd: s.timestampEnd || undefined,
    }));
    const userCorrectedSegments = savedSegments.filter((s) => s.userCorrected);
    const toSavedChange = (c: CorrectionChange): SavedCorrectionChange => ({
      from: c.from,
      to: c.to,
      source: c.source,
      autoApply: c.autoApply,
    });
    const saved: SavedTicket = {
      id,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      transcript,
      details,
      summaries,
      ticketFields,
      generatedTicket,
      detailLevel,
      reviewed: existing?.reviewed ?? false,
      copied: existing?.copied ?? false,
      rawTranscript: transcript,
      correctedTranscript: cleanedTranscript || transcript,
      speakerSegments: savedSegments,
      userCorrectedSpeakerSegments: userCorrectedSegments,
      correctionChanges: corrections.map(toSavedChange),
      approvedCorrections: approvedCorrections.map(toSavedChange),
      undoneCorrections: undoneCorrections.map(toSavedChange),
      nameCorrectionsApplied: [...nameCorrectionsApplied],
      extractionSourceVersion: EXTRACTION_SOURCE_VERSION,
      extractionTimestamp: nowIso(),
      audioId,
      transcriptVersions,
      // Preserve copy-log state across re-saves of the same ticket. A
      // fresh "Save Ticket" should never wipe the user's copy history.
      copyLog: existing?.copyLog ?? [],
      copySequenceCompleted: existing?.copySequenceCompleted ?? false,
    };
    try {
      ticketStore.upsert(saved);
    } catch (e) {
      set({
        status: {
          kind: "error",
          message: `Could not save ticket: ${(e as Error).message}`,
        },
      });
      return null;
    }
    set({ currentTicketId: id, status: { kind: "success", message: "Ticket saved locally." } });
    markRcSignal("lastTicketSaveAt");
    // If audio was attached as part of this save, record that signal too —
    // it's the most common attach path so the RC checklist's last-attach
    // pixel updates here rather than at every dedicated attach site.
    const audioForSignal = get().audio;
    const audioWasAttached =
      audioForSignal.wavPath && audioForSignal.isPersisted && attachAudio;
    if (audioWasAttached) {
      markRcSignal("lastAudioAttachAt");
    }
    // Phase 16 — pilot counters. A "ticket created" event fires once per
    // distinct ticket id; subsequent saves of the same ticket count as
    // updates and don't re-bump the counter.
    const isNew = !existing;
    if (isNew) {
      recordPilotEvent("ticketCreated");
      if (audioWasAttached) {
        recordPilotEvent("recordingAttached");
      } else if (transcript.trim()) {
        recordPilotEvent("ticketSavedWithoutAudio");
      }
      if (audioForSignal.wavPath && audioForSignal.isPersisted) {
        recordPilotEvent("recordingSaved");
      }
    }
    return saved;
  },

  markReviewed: () => {
    const { currentTicketId, settings } = get();
    if (!currentTicketId) {
      const saved = get().saveCurrentTicket();
      if (!saved) return;
    }
    const id = get().currentTicketId;
    if (!id) return;
    const existing = ticketStore.get(id);
    if (!existing) return;
    if (settings.disableHistory) return;
    ticketStore.upsert({ ...existing, reviewed: true, updatedAt: nowIso() });
    set({ status: { kind: "success", message: "Ticket marked as reviewed." } });
  },

  loadTicket: (id) => {
    const t = ticketStore.get(id);
    if (!t) return;
    const settings = get().settings;
    // Older saved tickets may pre-date newer fields (wrongCaller, transferNeeded,
    // transferDepartment, etc.). Merging with EMPTY_DETAILS guarantees every
    // field is defined so downstream generators don't crash on `undefined`.
    const details: ExtractedDetails = { ...EMPTY_DETAILS, ...t.details };
    const summaries =
      t.summaries ??
      generateAllSummaries({
        transcript: t.transcript,
        details,
        writingStyle: settings.writingStyle,
      });
    const ticketFields =
      t.ticketFields ??
      generateTicketFields({
        details,
        technicianName: settings.technicianName,
        writingStyle: settings.writingStyle,
      });
    // Prefer the saved speaker-labeled segments. If the ticket pre-dates the
    // audit trail (legacy tickets had no `speakerSegments` field), fall back to
    // re-detecting on the raw transcript so the editor still has something to
    // show, but flag the ticket as not having a saved speaker transcript.
    const savedSegments = (t.speakerSegments ?? []).map(
      (s): SpeakerSegment => ({
        id: s.id || `seg-${Math.random().toString(36).slice(2, 8)}`,
        speaker: s.speakerLabel as SpeakerLabel,
        text: s.repairedText ?? s.originalText ?? "",
        originalText: s.originalText ?? s.repairedText ?? "",
        timestampStart: s.timestampStart ?? "",
        timestampEnd: s.timestampEnd ?? "",
        confidence: s.confidence ?? "medium",
        userCorrected: !!s.userCorrected,
        reason: s.reason ?? "",
      }),
    );
    const speakerSegments =
      savedSegments.length > 0 ? savedSegments : detectSpeakers(t.transcript);
    const selfReview = runSelfReview({
      details,
      fields: ticketFields,
      speakerSegments,
      transcript: t.transcript,
    });
    const fromSaved = (c: SavedCorrectionChange): CorrectionChange => ({
      from: c.from,
      to: c.to,
      source: c.source,
      autoApply: c.autoApply,
    });
    set({
      currentTicketId: t.id,
      transcript: t.rawTranscript ?? t.transcript,
      cleanedTranscript: t.correctedTranscript ?? t.transcript,
      corrections: (t.correctionChanges ?? []).map(fromSaved),
      approvedCorrections: (t.approvedCorrections ?? []).map(fromSaved),
      undoneCorrections: (t.undoneCorrections ?? []).map(fromSaved),
      nameCorrectionsApplied: t.nameCorrectionsApplied ?? [],
      speakerSegments,
      selfReview,
      details,
      summaries,
      ticketFields,
      detailLevel: t.detailLevel,
      generatedTicket: t.generatedTicket,
      stage: "ticket",
    });
  },

  resetWorkflow: () => {
    if (activeLiveRecorder) {
      activeLiveRecorder.cancel();
      activeLiveRecorder = null;
    }
    revokeUrl(get().audio.blobUrl);
    const wavPath = get().audio.wavPath;
    if (wavPath) {
      deleteAudioFile(wavPath).catch(() => undefined);
    }
    set({
      stage: "idle",
      transcript: "",
      cleanedTranscript: "",
      corrections: [],
      approvedCorrections: [],
      undoneCorrections: [],
      nameCorrectionsApplied: [],
      speakerSegments: [],
      selfReview: { ...EMPTY_SELF_REVIEW },
      details: { ...EMPTY_DETAILS },
      summaries: { ...EMPTY_SUMMARIES },
      ticketFields: { ...EMPTY_TICKET_FIELDS },
      selectedSummary: "normal",
      generatedTicket: "",
      currentTicketId: null,
      status: null,
      busy: null,
      audio: { ...EMPTY_AUDIO },
      liveAssistAnswers: {},
      liveCapture: { ...EMPTY_LIVE_CAPTURE },
    });
  },

  setSpeakerLabel: (segmentId, speaker) => {
    set((s) => ({
      speakerSegments: applySpeakerCorrection(s.speakerSegments, segmentId, speaker),
    }));
  },

  bulkSetSpeakerLabels: (segmentIds, speaker) => {
    if (segmentIds.length === 0) return;
    set((s) => ({
      speakerSegments: applyBulkSpeakerCorrection(s.speakerSegments, segmentIds, speaker),
      status: {
        kind: "info",
        message: `Marked ${segmentIds.length} segment${segmentIds.length === 1 ? "" : "s"} as ${speaker.replace(/_/g, " ")}.`,
      },
    }));
  },

  alternateSpeakers: (firstSpeaker) => {
    set((s) => ({
      speakerSegments: applyAlternatingSpeakers(s.speakerSegments, firstSpeaker),
      status: {
        kind: "info",
        message: `Applied alternating speakers starting with ${firstSpeaker.replace(/_/g, " ")}.`,
      },
    }));
  },

  recordCorrectionResolution: (approved, undone) => {
    // Capture which corrections the user approved vs undone so the next save
    // bakes them into the audit trail. The actual undo of text was already
    // performed by CorrectionReview before calling this.
    set((s) => {
      const seen = new Set<string>();
      const dedupe = (list: CorrectionChange[]) =>
        list.filter((c) => {
          const k = `${c.from}→${c.to}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      return {
        approvedCorrections: dedupe([...s.approvedCorrections, ...approved]),
        undoneCorrections: dedupe([...s.undoneCorrections, ...undone]),
      };
    });
    if (approved.length + undone.length > 0) {
      recordPilotEvent("manualCorrection", approved.length + undone.length);
    }
  },

  reanalyzeFromSavedSpeakerTranscript: async () => {
    const segments = get().speakerSegments;
    if (segments.length === 0) {
      set({
        status: {
          kind: "warning",
          message:
            "No saved speaker transcript available — load a ticket from History or run analysis first.",
        },
      });
      return;
    }
    // Rebuild a labeled transcript from the user's speaker segments. The
    // detector's `explicitSpeakerLabel` recognizer reads the prefixes, so the
    // labels survive a fresh detection pass without needing the heuristic.
    const labeled = segments
      .map((s) => `${SPEAKER_PREFIX_FOR[s.speaker] ?? "Speaker"}: ${s.text}`)
      .join("\n\n");
    set({
      transcript: labeled,
      status: {
        kind: "info",
        message: "Re-running extraction from the saved speaker-labeled transcript…",
      },
    });
    await get().analyzeCurrentTranscript();
  },

  reanalyzeFromOriginalRawTranscript: async () => {
    // Replay the raw transcript through the full pipeline (corrector + speaker
    // detection + extraction). Useful when the user wants to check whether
    // updates to repair rules or the analyzer would change the output for an
    // older saved ticket.
    const raw = get().transcript;
    if (!raw.trim()) {
      set({
        status: { kind: "warning", message: "No raw transcript to replay." },
      });
      return;
    }
    set({
      undoneCorrections: [],
      status: {
        kind: "info",
        message: "Re-running extraction from the original raw transcript…",
      },
    });
    get().setTranscript(raw);
    await get().analyzeCurrentTranscript();
  },

  saveNameCorrection: (detected, corrected) => {
    const detectedKey = detected.trim().toLowerCase();
    const canonical = corrected.trim();
    if (!detectedKey || !canonical) return;
    const next = [
      ...get().settings.nameCorrections.filter((n) => n.detected !== detectedKey),
      { detected: detectedKey, corrected: canonical },
    ];
    get().updateSettings({ nameCorrections: next });
    set({
      status: {
        kind: "success",
        message: `Saved name hint: "${detected}" → "${canonical}". Future calls that hear "${detected}" will surface this as a hint.`,
      },
    });
  },

  applyNameCorrection: (corrected) => {
    const trimmed = corrected.trim();
    if (!trimmed) return;
    const detected = get().details.callerName;
    // Patch the displayed name immediately, but preserve the existing review
    // warning in confidenceNotes — the user just confirmed the spelling, but
    // the underlying transcript still says the misheard version.
    get().patchDetails({
      callerName: trimmed,
      contactName: trimmed,
      requesterName: trimmed,
    });
    if (detected && detected !== trimmed) {
      set((s) => ({
        nameCorrectionsApplied: [
          ...s.nameCorrectionsApplied.filter(
            (n) => n.detected.toLowerCase() !== detected.toLowerCase(),
          ),
          { detected, corrected: trimmed },
        ],
      }));
    }
  },

  saveSpeakerCorrections: () => {
    // Re-run self-review against the current corrected labels so the audit
    // reflects the user's choices without forcing a full re-extraction.
    const { details, ticketFields, speakerSegments, transcript } = get();
    const selfReview = runSelfReview({ details, fields: ticketFields, speakerSegments, transcript });
    const corrected = speakerSegments.filter((s) => s.userCorrected).length;
    set({
      selfReview,
      status: {
        kind: "success",
        message:
          corrected > 0
            ? `Saved ${corrected} speaker correction${corrected === 1 ? "" : "s"}. They'll be used the next time you re-run extraction.`
            : "No speaker corrections to save.",
      },
    });
  },

  rerunSelfReview: () => {
    const { details, ticketFields, speakerSegments, transcript } = get();
    const selfReview = runSelfReview({ details, fields: ticketFields, speakerSegments, transcript });
    set({
      selfReview,
      status: { kind: "info", message: "Self-review re-run." },
    });
  },

  reanalyzeWithSpeakerCorrections: async () => {
    set({
      status: {
        kind: "info",
        message: "Re-running extraction with corrected speaker labels…",
      },
    });
    await get().analyzeCurrentTranscript();
  },

  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    settingsStore.save(next);
    set({ settings: next });
  },

  reloadSettings: () => {
    set({ settings: settingsStore.load() });
  },

  setStatus: (status) => set({ status }),

  setStartupWarnings: (warnings: StartupWarning[]) => {
    set({ startupWarnings: warnings });
  },

  appendStartupWarning: (warning: StartupWarning) => {
    // Phase 16D — runtime events (mic plugged in / mic disappeared)
    // push into the same banner system as boot-time warnings. Dedupe by
    // id so a flapping device doesn't pile up duplicates.
    const existing = get().startupWarnings;
    if (existing.some((w) => w.id === warning.id)) return;
    set({ startupWarnings: [...existing, warning] });
  },

  dismissStartupWarning: (id: string) => {
    // Phase 16 bug fix — persist dismissals to localStorage so the user
    // isn't re-prompted with the same banner on every launch. Count-based
    // warnings (audio-files-missing, extractor-version-drift, reminders-due)
    // include the count in their id so the dismissal naturally expires when
    // the underlying state changes.
    const next = [
      ...get().dismissedStartupWarnings.filter((d) => d !== id),
      id,
    ];
    set({ dismissedStartupWarnings: next });
    writeDismissedStartupWarnings(next);
  },

  startRecording: async () => {
    if (activeLiveRecorder?.isRecording()) return;
    revokeUrl(get().audio.blobUrl);
    const oldPath = get().audio.wavPath;
    if (oldPath) {
      deleteAudioFile(oldPath).catch(() => undefined);
    }
    const settings = get().settings;
    // "manual" maps to a very long chunk interval — recorder still produces
    // one big chunk on stop, but no live previews fire during the call.
    const chunkSeconds =
      settings.liveAssist.chunkSizeSec === "manual"
        ? 3600
        : settings.liveAssist.chunkSizeSec;
    set({
      audio: {
        ...EMPTY_AUDIO,
        status: "recording",
        recordingStartedAt: Date.now(),
      },
      liveCapture: {
        ...EMPTY_LIVE_CAPTURE,
        status: "capturing",
        startedAt: Date.now(),
      },
      status: { kind: "info", message: "Recording — live preview updates after each chunk." },
    });
    // Serialize chunk processing so segments append in index order even if
    // a slow whisper invocation lets a later chunk finish first.
    let chunkChain: Promise<void> = Promise.resolve();
    activeLiveRecorder = new LiveChunkRecorder({
      chunkSeconds,
      onChunk: (chunk: ChunkPayload) => {
        chunkChain = chunkChain.then(() => processLiveChunk(chunk, get, set));
      },
    });
    try {
      const audioSettings = get().settings;
      await activeLiveRecorder.start({
        deviceId: audioSettings.audioInputDeviceId || undefined,
        noiseSuppression: audioSettings.audioNoiseSuppression,
        echoCancellation: audioSettings.audioEchoCancellation,
        autoGainControl: audioSettings.audioAutoGainControl,
      });
    } catch (e) {
      activeLiveRecorder = null;
      const message = (e as Error).message;
      set({
        audio: { ...EMPTY_AUDIO, status: "error", errorMessage: message },
        liveCapture: { ...EMPTY_LIVE_CAPTURE, status: "error", lastError: message },
        status: { kind: "error", message },
      });
    }
  },

  pauseRecording: () => {
    if (!activeLiveRecorder) return;
    if (!activeLiveRecorder.pause()) return;
    set((s) => ({
      audio: { ...s.audio, status: "paused", pausedAt: Date.now() },
      status: { kind: "info", message: "Recording paused." },
    }));
  },

  resumeRecording: () => {
    if (!activeLiveRecorder) return;
    if (!activeLiveRecorder.resume()) return;
    set((s) => {
      const pausedFor = s.audio.pausedAt ? Date.now() - s.audio.pausedAt : 0;
      return {
        audio: {
          ...s.audio,
          status: "recording",
          pausedAt: null,
          totalPausedMs: s.audio.totalPausedMs + pausedFor,
        },
        status: { kind: "info", message: "Recording resumed." },
      };
    });
  },

  stopRecording: async () => {
    if (!activeLiveRecorder) return;
    const recorder = activeLiveRecorder;
    activeLiveRecorder = null;

    set((s) => ({
      audio: { ...s.audio, status: "encoding", recordingStartedAt: null, pausedAt: null },
      liveCapture: { ...s.liveCapture, status: "finalizing" },
      status: { kind: "info", message: "Encoding audio to 16 kHz mono WAV…" },
    }));

    let recording: FinalRecording;
    try {
      recording = await recorder.stop();
    } catch (e) {
      const message = (e as Error).message;
      set({
        audio: { ...EMPTY_AUDIO, status: "error", errorMessage: message },
        liveCapture: { ...EMPTY_LIVE_CAPTURE, status: "error", lastError: message },
        status: { kind: "error", message },
      });
      return;
    }

    let wavBytes: Uint8Array<ArrayBuffer>;
    let durationMs: number;
    try {
      const encoded = await blobToWav16kMono(recording.blob);
      wavBytes = encoded.bytes;
      durationMs = encoded.durationMs || recording.durationMs;
    } catch (e) {
      const message = (e as Error).message;
      set((s) => ({
        audio: { ...EMPTY_AUDIO, status: "error", errorMessage: message },
        liveCapture: { ...s.liveCapture, status: "error", lastError: message },
        status: { kind: "error", message },
      }));
      return;
    }

    let wavPath: string | null = null;
    let isPersisted = false;
    if (isPersistenceAvailable()) {
      try {
        const filename = `recording-${nowIso().replace(/[:.]/g, "-")}.wav`;
        wavPath = await saveAudioFile(filename, wavBytes);
        isPersisted = true;
      } catch (e) {
        set((s) => ({
          status: {
            kind: "warning",
            message: `Recorded, but could not write WAV to disk (${(e as Error).message}). Transcription requires the desktop app.`,
          },
          audio: {
            ...s.audio,
            status: "ready",
            blobUrl: URL.createObjectURL(new Blob([wavBytes], { type: "audio/wav" })),
            blobMimeType: "audio/wav",
            durationMs,
            wavPath: null,
            isPersisted: false,
            errorMessage: null,
          },
          liveCapture: {
            ...s.liveCapture,
            status: "review",
            finalTranscript: "",
            finalTranscriptError: "Final transcription unavailable because the recording was not saved to disk.",
          },
        }));
        return;
      }
    }

    const blobUrl = URL.createObjectURL(new Blob([wavBytes], { type: "audio/wav" }));
    set((s) => ({
      audio: {
        status: "ready",
        blobUrl,
        blobMimeType: "audio/wav",
        durationMs,
        wavPath,
        isPersisted,
        errorMessage: null,
        recordingStartedAt: null,
        pausedAt: null,
        totalPausedMs: 0,
      },
      liveCapture: { ...s.liveCapture, status: "finalizing" },
      status: {
        kind: "success",
        message: isPersisted
          ? `Recording saved locally (${Math.round(durationMs / 1000)}s). Running final transcription…`
          : `Recording ready in memory (${Math.round(durationMs / 1000)}s). Transcription requires the desktop app.`,
      },
    }));

    const settings = get().settings;
    const whisperConfigured =
      !!settings.whisperExecutablePath.trim() && !!settings.whisperModelPath.trim();
    if (wavPath && whisperConfigured) {
      try {
        const r = await transcribeAudio({
          audioPath: wavPath,
          whisperPath: settings.whisperExecutablePath,
          modelPath: settings.whisperModelPath,
          language: settings.whisperLanguage || "en",
          threads: settings.whisperThreads || 4,
          prompt: settings.whisperPrompt || "",
        });
        const repaired = (r.text || "").trim()
          ? correctTranscript(r.text, {
              dictionary: settings.correctionDictionary,
              applyDictionary: settings.enableTranscriptCorrection !== false,
              applyNumberWords: settings.enableNumberWordNormalization !== false,
              applyDomainRepair: true,
            })
          : { text: "", changes: [] };
        set((s) => ({
          liveCapture: {
            ...s.liveCapture,
            status: "review",
            finalTranscript: repaired.text,
            finalTranscriptError: null,
          },
          status: {
            kind: "success",
            message: "Final transcript ready. Choose Live, Final, or Edit below.",
          },
        }));
      } catch (e) {
        const msg = friendlyWhisperError(e);
        set((s) => ({
          liveCapture: {
            ...s.liveCapture,
            status: "review",
            finalTranscript: "",
            finalTranscriptError: msg,
          },
          status: { kind: "warning", message: `Final transcription failed: ${msg}` },
        }));
      }
    } else {
      set((s) => ({
        liveCapture: {
          ...s.liveCapture,
          status: "review",
          finalTranscript: "",
          finalTranscriptError: whisperConfigured
            ? "Final transcription unavailable because the recording was not saved to disk."
            : "Final transcription unavailable because whisper.cpp is not configured.",
        },
        status: whisperConfigured
          ? s.status
          : {
              kind: "info",
              message:
                "Recording saved locally. Configure whisper.cpp in Settings to get a final transcript, or paste one manually.",
            },
      }));
    }
  },

  cancelRecording: () => {
    if (activeLiveRecorder) {
      activeLiveRecorder.cancel();
      activeLiveRecorder = null;
    }
    revokeUrl(get().audio.blobUrl);
    const wavPath = get().audio.wavPath;
    if (wavPath) {
      deleteAudioFile(wavPath).catch(() => undefined);
    }
    set({
      audio: { ...EMPTY_AUDIO },
      liveCapture: { ...EMPTY_LIVE_CAPTURE },
      status: { kind: "info", message: "Recording cancelled." },
    });
  },

  deleteAudio: async () => {
    revokeUrl(get().audio.blobUrl);
    const wavPath = get().audio.wavPath;
    if (wavPath) {
      try {
        await deleteAudioFile(wavPath);
      } catch (e) {
        set({
          status: {
            kind: "warning",
            message: `Audio cleared from memory but could not delete file: ${(e as Error).message}`,
          },
        });
      }
    }
    set({
      audio: { ...EMPTY_AUDIO },
      status: { kind: "success", message: "Audio deleted." },
    });
  },

  transcribeRecording: async () => {
    const { audio, settings } = get();
    if (audio.status !== "ready" || !audio.wavPath) {
      set({
        status: {
          kind: "warning",
          message:
            "No saved recording to transcribe. Record audio first (and use the desktop app — browser preview cannot transcribe).",
        },
      });
      return;
    }
    if (!settings.whisperExecutablePath.trim() || !settings.whisperModelPath.trim()) {
      set({
        status: {
          kind: "warning",
          message:
            "Set the whisper.cpp executable path and model path in Settings → Local Transcription first.",
        },
      });
      return;
    }

    set((s) => ({
      audio: { ...s.audio, status: "transcribing", errorMessage: null },
      status: {
        kind: "info",
        message: `Transcribing locally with whisper.cpp (${settings.whisperLanguage || "auto"}, ${settings.whisperThreads || 4} thread(s))…`,
      },
    }));

    try {
      const r = await transcribeAudio({
        audioPath: audio.wavPath,
        whisperPath: settings.whisperExecutablePath,
        modelPath: settings.whisperModelPath,
        language: settings.whisperLanguage,
        threads: settings.whisperThreads,
        prompt: settings.whisperPrompt || "",
      });
      const transcript = r.text.trim();
      if (!transcript) {
        set((s) => ({
          audio: { ...s.audio, status: "ready" },
          status: {
            kind: "warning",
            message:
              "whisper.cpp finished but produced no text. Try a longer recording, a larger model, or check audio levels.",
          },
        }));
        return;
      }

      set((s) => ({
        transcript,
        stage: "transcript",
        audio: { ...s.audio, status: "ready" },
        status: {
          kind: "success",
          message: `Transcribed locally (${transcript.length} chars). Review below, then Analyze.`,
        },
      }));
      recordPilotEvent("finalTranscriptUsed");

      const shouldDelete =
        !settings.saveAudio || settings.deleteAudioAfterTranscription;
      if (shouldDelete && get().audio.wavPath) {
        const path = get().audio.wavPath;
        await deleteAudioFile(path).catch(() => undefined);
        revokeUrl(get().audio.blobUrl);
        set({ audio: { ...EMPTY_AUDIO } });
      }
    } catch (e) {
      const message = friendlyWhisperError(e);
      set((s) => ({
        audio: { ...s.audio, status: "ready", errorMessage: message },
        status: { kind: "error", message },
      }));
    }
  },

  loadOrphanedRecording: async (path, durationMs) => {
    if (!isPersistenceAvailable()) {
      set({
        status: {
          kind: "warning",
          message: "Recovering recordings requires the desktop app.",
        },
      });
      return;
    }
    revokeUrl(get().audio.blobUrl);
    try {
      const bytes = await readAudioFile(path);
      const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
      const blobUrl = URL.createObjectURL(blob);
      set({
        audio: {
          status: "ready",
          blobUrl,
          blobMimeType: "audio/wav",
          durationMs: durationMs && durationMs > 0 ? durationMs : 0,
          wavPath: path,
          isPersisted: true,
          errorMessage: null,
          recordingStartedAt: null,
          pausedAt: null,
          totalPausedMs: 0,
        },
        status: {
          kind: "success",
          message:
            "Recording restored. Click Transcribe to run whisper.cpp, then Save Ticket to keep it linked.",
        },
      });
    } catch (e) {
      const message = (e as Error).message;
      set({
        status: {
          kind: "error",
          message: `Could not load recording: ${message}`,
        },
      });
    }
  },

  // ── Phase 3: Audio + Transcript Versioning ────────────────────────────

  retranscribeTicketAudio: async (ticketId) => {
    const ticket = ticketStore.get(ticketId);
    if (!ticket) {
      set({ status: { kind: "warning", message: "Ticket not found." } });
      return null;
    }
    const audio = ticket.audioId ? audioFilesStore.get(ticket.audioId) : undefined;
    if (!audio) {
      set({
        status: {
          kind: "warning",
          message: "No audio recording linked to this ticket.",
        },
      });
      return null;
    }
    if (audio.deleted) {
      set({
        status: {
          kind: "warning",
          message:
            "Audio for this ticket has been deleted — re-transcription is not possible.",
        },
      });
      return null;
    }
    const settings = get().settings;
    if (!settings.whisperExecutablePath.trim() || !settings.whisperModelPath.trim()) {
      set({
        status: {
          kind: "warning",
          message:
            "whisper.cpp is not configured. Configure it in Settings to re-transcribe audio.",
        },
      });
      return null;
    }
    set({
      status: {
        kind: "info",
        message: `Re-transcribing audio with whisper.cpp (${settings.whisperLanguage || "auto"})…`,
      },
    });
    try {
      const r = await transcribeAudio({
        audioPath: audio.path,
        whisperPath: settings.whisperExecutablePath,
        modelPath: settings.whisperModelPath,
        language: settings.whisperLanguage,
        threads: settings.whisperThreads,
        prompt: settings.whisperPrompt || "",
      });
      const text = r.text.trim();
      if (!text) {
        set({
          status: {
            kind: "warning",
            message:
              "whisper.cpp finished but produced no text. Try a longer recording or a larger model.",
          },
        });
        return null;
      }
      const version: TranscriptVersion = {
        id: newId(),
        source: "re-transcribed",
        text,
        createdAt: nowIso(),
        whisperModel: settings.whisperModelPath.split(/[/\\]/).pop() ?? "",
      };
      const next: SavedTicket = {
        ...ticket,
        transcriptVersions: [...(ticket.transcriptVersions ?? []), version],
        updatedAt: nowIso(),
      };
      ticketStore.upsert(next);
      audioFilesStore.setTranscriptStatus(audio.id, "re-transcribed");
      set({
        status: {
          kind: "success",
          message: `New transcript saved (${text.length} chars). Compare and choose which to use.`,
        },
      });
      return version;
    } catch (e) {
      const message = friendlyWhisperError(e);
      set({ status: { kind: "error", message } });
      return null;
    }
  },

  applyTranscriptVersionToTicket: async (ticketId, transcriptText, source) => {
    const ticket = ticketStore.get(ticketId);
    if (!ticket) {
      set({ status: { kind: "warning", message: "Ticket not found." } });
      return;
    }
    if (source === "edited") {
      const editedVersion: TranscriptVersion = {
        id: newId(),
        source: "edited",
        text: transcriptText,
        createdAt: nowIso(),
      };
      ticketStore.upsert({
        ...ticket,
        transcriptVersions: [...(ticket.transcriptVersions ?? []), editedVersion],
        updatedAt: nowIso(),
      });
    }
    // Load the ticket as the current workflow ticket so re-extraction reuses
    // the existing field-generation / writing-style / settings paths. The
    // user explicitly chose to apply this transcript, so it's safe to take
    // over the workflow editor.
    get().loadTicket(ticketId);
    set({ transcript: transcriptText, undoneCorrections: [] });
    await get().analyzeCurrentTranscript();
    get().saveCurrentTicket();
    set({
      status: {
        kind: "success",
        message:
          "Re-extraction complete. New transcript and ticket fields saved — original transcript is still preserved in version history.",
      },
    });
  },

  recordFieldCorrection: (field, before, after, note) => {
    let id = get().currentTicketId;
    if (!id) {
      const saved = get().saveCurrentTicket();
      if (!saved) {
        set({
          status: {
            kind: "warning",
            message: "Save the ticket first so the correction can be linked to it.",
          },
        });
        return null;
      }
      id = saved.id;
    }
    if (before === after) {
      set({
        status: {
          kind: "info",
          message: `No change captured — '${field}' is identical to the AI value.`,
        },
      });
      return null;
    }
    const fields = get().ticketFields;
    const correction: FieldCorrection = {
      field,
      before,
      after,
      note,
      createdAt: nowIso(),
    };
    const existing = ticketFeedbackStore.latestForTicket(id);
    const merged = ticketFeedbackStore.upsert({
      id: existing?.id,
      ticketId: id,
      // Snapshot the AI-generated values once. We never overwrite them on
      // subsequent corrections so the audit trail stays anchored.
      originalSubject: existing?.originalSubject || fields.subject,
      correctedSubject: field === "subject" ? after : existing?.correctedSubject ?? "",
      originalDescription: existing?.originalDescription || fields.description,
      correctedDescription:
        field === "description" ? after : existing?.correctedDescription ?? "",
      originalResolution: existing?.originalResolution || fields.resolution,
      correctedResolution:
        field === "resolution" ? after : existing?.correctedResolution ?? "",
      correctedFields: [...(existing?.correctedFields ?? []), correction],
      whatAiMissed: existing?.whatAiMissed ?? "",
      resolutionWorked: existing?.resolutionWorked ?? "unknown",
      styleExampleId: existing?.styleExampleId ?? null,
    });
    set({
      status: {
        kind: "success",
        message: `Saved correction for ${field}.`,
      },
    });
    return merged;
  },

  recordAIMissed: (note, field, correctValue) => {
    let id = get().currentTicketId;
    if (!id) {
      const saved = get().saveCurrentTicket();
      if (!saved) {
        set({
          status: {
            kind: "warning",
            message: "Save the ticket first so the missed-detail note can be linked.",
          },
        });
        return null;
      }
      id = saved.id;
    }
    const trimmed = note.trim();
    if (!trimmed && !correctValue) {
      set({
        status: { kind: "warning", message: "Add a note or correct value first." },
      });
      return null;
    }
    const existing = ticketFeedbackStore.latestForTicket(id);
    const fields = get().ticketFields;
    const correction: FieldCorrection | null =
      field && correctValue
        ? {
            field,
            before: "",
            after: correctValue,
            note: trimmed,
            createdAt: nowIso(),
          }
        : null;
    const merged = ticketFeedbackStore.upsert({
      id: existing?.id,
      ticketId: id,
      originalSubject: existing?.originalSubject || fields.subject,
      correctedSubject: existing?.correctedSubject ?? "",
      originalDescription: existing?.originalDescription || fields.description,
      correctedDescription: existing?.correctedDescription ?? "",
      originalResolution: existing?.originalResolution || fields.resolution,
      correctedResolution: existing?.correctedResolution ?? "",
      correctedFields: correction
        ? [...(existing?.correctedFields ?? []), correction]
        : existing?.correctedFields ?? [],
      whatAiMissed: existing?.whatAiMissed
        ? `${existing.whatAiMissed}\n${trimmed}`
        : trimmed,
      resolutionWorked: existing?.resolutionWorked ?? "unknown",
      styleExampleId: existing?.styleExampleId ?? null,
    });
    set({
      status: { kind: "success", message: "AI-missed note saved." },
    });
    return merged;
  },

  setResolutionStatus: (status) => {
    let id = get().currentTicketId;
    if (!id) {
      const saved = get().saveCurrentTicket();
      if (!saved) {
        set({
          status: {
            kind: "warning",
            message: "Save the ticket first so the resolution status can be linked.",
          },
        });
        return null;
      }
      id = saved.id;
    }
    const existing = ticketFeedbackStore.latestForTicket(id);
    const fields = get().ticketFields;
    const merged = ticketFeedbackStore.upsert({
      id: existing?.id,
      ticketId: id,
      originalSubject: existing?.originalSubject || fields.subject,
      correctedSubject: existing?.correctedSubject ?? "",
      originalDescription: existing?.originalDescription || fields.description,
      correctedDescription: existing?.correctedDescription ?? "",
      originalResolution: existing?.originalResolution || fields.resolution,
      correctedResolution: existing?.correctedResolution ?? "",
      correctedFields: existing?.correctedFields ?? [],
      whatAiMissed: existing?.whatAiMissed ?? "",
      resolutionWorked: status,
      styleExampleId: existing?.styleExampleId ?? null,
    });
    const label =
      status === "worked"
        ? "Resolution worked."
        : status === "did-not-work"
          ? "Resolution did not work."
          : "Resolution outcome marked unknown.";
    set({ status: { kind: "success", message: label } });
    return merged;
  },

  saveCurrentTicketAsStyleExample: (overrides) => {
    let id = get().currentTicketId;
    if (!id) {
      const saved = get().saveCurrentTicket();
      if (!saved) {
        set({
          status: {
            kind: "warning",
            message: "Save the ticket first to capture it as a style example.",
          },
        });
        return null;
      }
      id = saved.id;
    }
    const fields = get().ticketFields;
    const transcript = get().transcript;
    if (!fields.subject.trim() && !fields.description.trim()) {
      set({
        status: {
          kind: "warning",
          message:
            "Generate a ticket first — there's no subject or description to capture as an example.",
        },
      });
      return null;
    }
    const ex = styleExamplesStore.upsert({
      title: overrides?.title || fields.subject || `Example from ${id.slice(0, 8)}`,
      rawInput: transcript,
      idealSubject: fields.subject,
      idealDescription: fields.description,
      idealResolution: fields.resolution,
      idealPartRequest: fields.partRequest,
      notes: overrides?.notes ?? "",
    });
    // Link the example back to the ticket via the feedback row so Inspect
    // can show "Style example created from this ticket".
    const existing = ticketFeedbackStore.latestForTicket(id);
    ticketFeedbackStore.upsert({
      id: existing?.id,
      ticketId: id,
      originalSubject: existing?.originalSubject || fields.subject,
      correctedSubject: existing?.correctedSubject ?? "",
      originalDescription: existing?.originalDescription || fields.description,
      correctedDescription: existing?.correctedDescription ?? "",
      originalResolution: existing?.originalResolution || fields.resolution,
      correctedResolution: existing?.correctedResolution ?? "",
      correctedFields: existing?.correctedFields ?? [],
      whatAiMissed: existing?.whatAiMissed ?? "",
      resolutionWorked: existing?.resolutionWorked ?? "unknown",
      styleExampleId: ex.id,
    });
    set({
      status: {
        kind: "success",
        message: "Style example saved. Future tickets in similar categories will use it.",
      },
    });
    return ex;
  },

  deleteTicketAudio: async (ticketId) => {
    const ticket = ticketStore.get(ticketId);
    if (!ticket) return;
    const audio = ticket.audioId ? audioFilesStore.get(ticket.audioId) : undefined;
    if (!audio) {
      set({
        status: { kind: "info", message: "No audio file is linked to this ticket." },
      });
      return;
    }
    try {
      await deleteAudioFile(audio.path);
    } catch (e) {
      // Even if the on-disk delete failed, mark the row deleted so the UI
      // matches the user's intent. The recordError pipeline keeps the warning
      // visible in Settings → Recent Storage Errors.
      // eslint-disable-next-line no-console
      console.warn("[deleteTicketAudio] file delete failed:", e);
    }
    audioFilesStore.markDeleted(audio.id);
    ticketStore.upsert({
      ...ticket,
      audioId: null,
      updatedAt: nowIso(),
    });
    set({
      status: {
        kind: "success",
        message:
          "Audio deleted. The ticket is preserved — open History → Inspect to see version history.",
      },
    });
  },

  // ── Phase 6: Reminders ─────────────────────────────────────────────────

  createReminder: ({ title, message, dueAt, storeNumber, ticketId }) => {
    const trimmed = title.trim();
    if (!trimmed) {
      set({
        status: {
          kind: "warning",
          message: "Reminder needs a title before it can be saved.",
        },
      });
      return null;
    }
    // Resolve a ticket ID when the caller didn't pass one explicitly. We
    // never *force* a save — the reminder can be free-form (eg. "call ATT
    // back about Store 521" with no current ticket) — but if the user is
    // mid-workflow on an unsaved ticket, save first so the link sticks.
    let resolvedTicketId = ticketId ?? get().currentTicketId ?? "";
    if (!resolvedTicketId && (get().ticketFields.subject.trim() || get().details.issue?.trim())) {
      const saved = get().saveCurrentTicket();
      if (saved) resolvedTicketId = saved.id;
    }
    const resolvedStore = (storeNumber ?? get().details.storeNumber ?? "").trim();
    const reminder = remindersStore.create({
      title: trimmed,
      message: message.trim(),
      dueAt: dueAt || undefined,
      storeNumber: resolvedStore,
      ticketId: resolvedTicketId,
    });
    set({
      status: {
        kind: "success",
        message: dueAt
          ? `Reminder saved. Due ${formatDueLabel(dueAt)}.`
          : "Reminder saved.",
      },
    });
    return reminder;
  },

  completeReminder: (id) => {
    const next = remindersStore.setStatus(id, "completed");
    if (next) set({ status: { kind: "success", message: "Reminder marked complete." } });
    return next;
  },

  snoozeReminder: (id, untilIso) => {
    const next = remindersStore.setStatus(id, "snoozed", { snoozeUntil: untilIso });
    if (next) {
      set({
        status: {
          kind: "info",
          message: `Snoozed until ${formatDueLabel(untilIso)}.`,
        },
      });
    }
    return next;
  },

  dismissReminder: (id) => {
    const next = remindersStore.setStatus(id, "dismissed");
    if (next) set({ status: { kind: "info", message: "Reminder dismissed." } });
    return next;
  },

  deleteReminder: (id) => {
    remindersStore.remove(id);
    set({ status: { kind: "info", message: "Reminder deleted." } });
  },

  reopenReminder: (id) => {
    return remindersStore.setStatus(id, "open", { snoozeUntil: undefined });
  },

  updateReminder: (id, patch) => {
    return remindersStore.update(id, patch);
  },

  resumeExpiredReminderSnoozes: () => {
    const resumed = remindersStore.resumeExpiredSnoozes();
    return resumed.length;
  },

  // ── Phase 7: Knowledge Base ────────────────────────────────────────────

  createKnowledgeItem: (input) => {
    const trimmed = input.title.trim();
    if (!trimmed) {
      set({
        status: {
          kind: "warning",
          message: "Knowledge item needs a title before it can be saved.",
        },
      });
      return null;
    }
    const item = knowledgeStore.create({
      type: input.type,
      title: trimmed,
      content: input.content,
    });
    set({
      status: { kind: "success", message: "Knowledge item saved." },
    });
    return item;
  },

  updateKnowledgeItem: (id, patch) => {
    const next = knowledgeStore.update(id, patch);
    if (next) {
      set({ status: { kind: "success", message: "Knowledge item updated." } });
    }
    return next;
  },

  upsertKnowledgeItem: (item) => {
    const next = knowledgeStore.upsert(item);
    set({ status: { kind: "success", message: "Knowledge item saved." } });
    return next;
  },

  deleteKnowledgeItem: (id) => {
    knowledgeStore.remove(id);
    set({ status: { kind: "info", message: "Knowledge item deleted." } });
  },

  createKnowledgeFromTicket: (input) => {
    // Resolve the linked ticket id, saving the current workflow ticket first
    // if the caller didn't pass one and there's content worth saving. This
    // mirrors the Phase 6 createReminder flow so a freshly-typed ticket can
    // still be captured into the KB without an extra Save click.
    let resolvedTicketId = input.ticketId ?? get().currentTicketId ?? "";
    if (!resolvedTicketId) {
      const hasContent =
        get().ticketFields.subject.trim() ||
        get().details.issue?.trim() ||
        get().generatedTicket.trim();
      if (hasContent) {
        const saved = get().saveCurrentTicket();
        if (saved) resolvedTicketId = saved.id;
      }
    }

    const details = get().details;
    const fields = get().ticketFields;
    const fallbackTitle = fields.subject || details.issue || "Knowledge item";
    const titleSeed = (input.title ?? fallbackTitle).trim() || fallbackTitle;

    // Per-type prefill rules. Each branch reads from the current ticket when
    // it makes sense and leaves the rest of the content to the caller's
    // overrides (passed via `input.content`).
    const prefillContent = buildPrefillContent(input.type, {
      details,
      fields,
      ticketId: resolvedTicketId,
    });
    const merged = {
      ...prefillContent,
      ...(input.content ?? {}),
    } as KnowledgeContentByType[typeof input.type];

    const item = knowledgeStore.create({
      type: input.type,
      title: titleSeed,
      content: merged,
    });
    set({
      status: {
        kind: "success",
        message:
          "Knowledge item captured from this ticket. Edit on the Knowledge Base page.",
      },
    });
    return item;
  },

  // ── Phase 9: Copy Mode ─────────────────────────────────────────────────

  copyModeActive: false,

  setCopyModeActive: (active) => set({ copyModeActive: active }),

  recordFieldCopied: (field, value) => {
    // Resolve the ticket id, saving the workflow ticket first if it has
    // content but isn't yet persisted. Mirrors the Phase 4/6/7 pattern so
    // the copy log always points at a real row.
    let id = get().currentTicketId;
    if (!id) {
      const hasContent =
        get().ticketFields.subject.trim() ||
        get().ticketFields.description.trim() ||
        get().generatedTicket.trim();
      if (!hasContent) return null;
      const saved = get().saveCurrentTicket();
      if (!saved) return null;
      id = saved.id;
    }
    const ticket = ticketStore.get(id);
    if (!ticket) return null;
    const entry: CopyLogEntry = {
      field,
      value,
      copiedAt: nowIso(),
    };
    const next: SavedTicket = {
      ...ticket,
      copyLog: [...(ticket.copyLog ?? []), entry],
      updatedAt: nowIso(),
    };
    try {
      ticketStore.upsert(next);
    } catch (e) {
      set({
        status: { kind: "error", message: `Could not record copy: ${(e as Error).message}` },
      });
      return null;
    }
    return entry;
  },

  markCopySequenceCompleted: () => {
    const id = get().currentTicketId;
    if (!id) return;
    const ticket = ticketStore.get(id);
    if (!ticket) return;
    if (ticket.copySequenceCompleted) return;
    ticketStore.upsert({
      ...ticket,
      copySequenceCompleted: true,
      updatedAt: nowIso(),
    });
    recordPilotEvent("ticketCopiedWithCopyMode");
    set({
      status: {
        kind: "success",
        message: "Copy sequence marked complete. Saved to ticket history.",
      },
    });
  },

  resetCopyLog: () => {
    const id = get().currentTicketId;
    if (!id) return;
    const ticket = ticketStore.get(id);
    if (!ticket) return;
    ticketStore.upsert({
      ...ticket,
      copyLog: [],
      copySequenceCompleted: false,
      updatedAt: nowIso(),
    });
    set({ status: { kind: "info", message: "Copy log cleared for this ticket." } });
  },

  // ── Phase 10A: Live Assist inline answers ─────────────────────────────
  // (Initial state declared above with the rest of the Zustand state.)

  setLiveAssistAnswer: (kind, value) => {
    const next: LiveAssistAnswers = { ...get().liveAssistAnswers };
    const trimmed = typeof value === "string" ? value.trim() : value;
    if (!trimmed) {
      delete next[kind];
    } else {
      // Cast through LiveAssistAnswers's value type — the generic narrows it.
      (next as Record<string, unknown>)[kind] = trimmed;
    }
    set({ liveAssistAnswers: next });
    // Apply immediately on top of any current details/ticketFields so the
    // detected detail cards reflect the answer without waiting for re-analyze.
    const details = applyLiveAssistAnswersToDetails(get().details, next);
    const fields = applyLiveAssistAnswersToFields(get().ticketFields, next);
    set({ details, ticketFields: fields });

    // Phase 10B — learn a pattern from this answer so future calls with
    // similar phrasing auto-fill the same kind. Skip the result kind because
    // we're matching a TicketResult enum, not a transcript substring.
    if (typeof trimmed === "string" && trimmed && kind !== "result") {
      try {
        const transcript = get().transcript;
        if (transcript.trim().length >= 10) {
          const derived = deriveLearnedPattern(transcript, kind, trimmed);
          if (derived) {
            extractionPatternsStore.upsertLearned({
              kind,
              label: `Learned · ${EXTRACTION_KIND_LABELS[kind]} · ${trimmed.slice(0, 24)}`,
              pattern: derived.pattern,
              flags: derived.flags,
              captureGroup: derived.captureGroup,
              example: derived.example,
            });
          }
        }
      } catch {
        // Learning is best-effort — never block the user's answer.
      }
    }
  },

  clearLiveAssistAnswers: () => set({ liveAssistAnswers: {} }),

  // ── Phase 11A: Live capture review actions ────────────────────────────

  acceptLiveTranscript: () => {
    const live = get().liveCapture.liveTranscript;
    if (!live.trim()) {
      set({
        status: {
          kind: "warning",
          message: "Live transcript is empty — choose Final or paste a transcript manually.",
        },
      });
      return;
    }
    get().setTranscript(live);
    set((s) => ({
      liveCapture: { ...s.liveCapture, status: "idle" },
      status: { kind: "success", message: "Using live transcript for analysis." },
    }));
  },

  acceptFinalTranscript: () => {
    const final = get().liveCapture.finalTranscript;
    if (!final.trim()) {
      set({
        status: {
          kind: "warning",
          message: "Final transcript is empty — pick Live or Edit instead.",
        },
      });
      return;
    }
    get().setTranscript(final);
    set((s) => ({
      liveCapture: { ...s.liveCapture, status: "idle" },
      status: { kind: "success", message: "Using final transcript for analysis." },
    }));
  },

  acceptEditedTranscript: (text) => {
    if (!text.trim()) {
      set({ status: { kind: "warning", message: "Edited transcript is empty." } });
      return;
    }
    get().setTranscript(text);
    set((s) => ({
      liveCapture: { ...s.liveCapture, status: "idle" },
      status: { kind: "success", message: "Using edited transcript for analysis." },
    }));
  },

  setLiveSegmentSpeaker: (segmentId, speaker) => {
    set((s) => {
      const segments = s.liveCapture.segments.map((seg) =>
        seg.id === segmentId
          ? {
              ...seg,
              speaker,
              confidence: "high" as const,
              userCorrected: true,
              reason: "Corrected by you.",
            }
          : seg,
      );
      return { liveCapture: { ...s.liveCapture, segments } };
    });
  },

  rerunLiveSpeakerDetection: () => {
    set((s) => {
      let prev: PrevSegmentHint | null = null;
      const segments = s.liveCapture.segments.map((seg) => {
        if (seg.userCorrected) {
          prev = {
            speaker: seg.speaker,
            text: seg.repairedText,
            confidence: seg.confidence,
          };
          return seg;
        }
        if (!seg.repairedText.trim()) return seg;
        const r = classifyWithContext(seg.repairedText, prev);
        const next: LiveSegment = {
          ...seg,
          speaker: r.speaker,
          confidence: r.confidence,
          reason: r.reason,
        };
        prev = {
          speaker: r.speaker,
          text: seg.repairedText,
          confidence: r.confidence,
        };
        return next;
      });
      return {
        liveCapture: { ...s.liveCapture, segments },
        status: { kind: "info", message: "Live speaker labels re-detected." },
      };
    });
  },

  rerunLiveExtraction: () => {
    set((s) => ({
      liveCapture: {
        ...s.liveCapture,
        extractionVersion: s.liveCapture.extractionVersion + 1,
      },
      status: { kind: "info", message: "Live extraction refreshed." },
    }));
  },

  clearLiveCapture: () => set({ liveCapture: { ...EMPTY_LIVE_CAPTURE } }),

  replaceAudioOnCurrentTicket: () => {
    const { currentTicketId, audio } = get();
    if (!currentTicketId) {
      set({
        status: {
          kind: "error",
          message: "Save the ticket first before replacing the recording.",
        },
      });
      return false;
    }
    if (!audio.isPersisted || !audio.wavPath) {
      set({
        status: {
          kind: "error",
          message: "No new local recording available to attach.",
        },
      });
      return false;
    }
    const existingTicket = ticketStore.get(currentTicketId);
    const existingAudioId = existingTicket?.audioId ?? null;
    if (existingAudioId) {
      audioFilesStore.markDeleted(existingAudioId);
    }
    const newAudioId = newId();
    audioFilesStore.upsert({
      id: newAudioId,
      ticketId: currentTicketId,
      path: audio.wavPath,
      durationMs: audio.durationMs,
      format: "wav",
      createdAt: nowIso(),
      deleted: false,
      transcriptStatus: get().transcript.trim() ? "transcribed" : "pending",
    });
    if (existingTicket) {
      ticketStore.upsert({ ...existingTicket, audioId: newAudioId });
    }
    set({
      status: { kind: "success", message: "Recording replaced on this ticket." },
    });
    return true;
  },

  attachExistingRecording: async (sourcePath) => {
    try {
      const destPath = await importAudioFile(sourcePath);
      // Make sure the ticket is saved first so we have a ticketId to link to.
      let ticketId = get().currentTicketId;
      if (!ticketId) {
        // Skip auto-attach here — we'll link the imported file manually.
        const saved = get().saveCurrentTicket({ attachAudio: false });
        if (!saved) {
          set({
            status: {
              kind: "error",
              message: "Could not save the ticket — attach aborted.",
            },
          });
          return false;
        }
        ticketId = saved.id;
      }
      // Mark any existing attachment deleted so History shows the swap.
      const existing = ticketStore.get(ticketId);
      if (existing?.audioId) {
        audioFilesStore.markDeleted(existing.audioId);
      }
      const newAudioId = newId();
      audioFilesStore.upsert({
        id: newAudioId,
        ticketId,
        path: destPath,
        durationMs: 0, // unknown — duration probe could fill this in later
        format: destPath.split(".").pop() ?? "wav",
        createdAt: nowIso(),
        deleted: false,
        transcriptStatus: "pending",
      });
      if (existing) {
        ticketStore.upsert({ ...existing, audioId: newAudioId });
      }
      set({
        status: {
          kind: "success",
          message: "Existing recording attached to ticket.",
        },
      });
      return true;
    } catch (e) {
      const message = (e as Error).message || String(e);
      set({
        status: { kind: "error", message: `Attach failed: ${message}` },
      });
      return false;
    }
  },

  setLiveCallerName: (name) => {
    const trimmed = name.trim();
    set((s) => {
      const nextAnswers = { ...s.liveAssistAnswers };
      if (trimmed) {
        nextAnswers.callerName = trimmed;
      } else {
        delete nextAnswers.callerName;
      }
      return {
        liveCapture: {
          ...s.liveCapture,
          detectedCallerName: trimmed,
          callerNameConfidence: trimmed ? "high" : "low",
          callerNameUserCorrected: trimmed.length > 0,
          // Bump extractionVersion so the LiveAssistPanel memo re-evaluates
          // and the missing-detail alert for caller name disappears at once.
          extractionVersion: s.liveCapture.extractionVersion + 1,
        },
        liveAssistAnswers: nextAnswers,
        status: trimmed
          ? { kind: "info", message: `Caller name set to ${trimmed}.` }
          : { kind: "info", message: "Caller name cleared." },
      };
    });
  },

  setLiveSegmentText: (segmentId, text) => {
    set((s) => {
      const segments = s.liveCapture.segments.map((seg) =>
        seg.id === segmentId
          ? { ...seg, repairedText: text, textEdited: true }
          : seg,
      );
      return {
        liveCapture: {
          ...s.liveCapture,
          segments,
          liveTranscript: buildLiveTranscript(segments),
          extractionVersion: s.liveCapture.extractionVersion + 1,
        },
        status: { kind: "info", message: "Segment text updated." },
      };
    });
  },

  toggleLiveSegmentImportant: (segmentId) => {
    set((s) => {
      const segments = s.liveCapture.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, important: !seg.important } : seg,
      );
      return { liveCapture: { ...s.liveCapture, segments } };
    });
  },

  toggleLiveSegmentWrong: (segmentId) => {
    set((s) => {
      const segments = s.liveCapture.segments.map((seg) =>
        seg.id === segmentId
          ? { ...seg, wrongTranscription: !seg.wrongTranscription }
          : seg,
      );
      return {
        liveCapture: {
          ...s.liveCapture,
          segments,
          liveTranscript: buildLiveTranscript(segments),
          extractionVersion: s.liveCapture.extractionVersion + 1,
        },
      };
    });
  },

  saveUpdatedTranscript: (text) => {
    const cleaned = text.trim();
    set((s) => ({
      liveCapture: {
        ...s.liveCapture,
        liveTranscript: cleaned,
        extractionVersion: s.liveCapture.extractionVersion + 1,
      },
      status: {
        kind: "info",
        message: "Updated transcript saved. Re-run extraction or speaker detection if needed.",
      },
    }));
  },

  revertLiveSegmentCorrections: (segmentId) => {
    set((s) => {
      const segments = s.liveCapture.segments.map((seg) =>
        seg.id === segmentId
          ? {
              ...seg,
              repairedText: seg.rawText,
              textEdited: true,
              corrections: [],
            }
          : seg,
      );
      return {
        liveCapture: {
          ...s.liveCapture,
          segments,
          liveTranscript: buildLiveTranscript(segments),
          extractionVersion: s.liveCapture.extractionVersion + 1,
        },
        status: { kind: "info", message: "Corrections reverted for this segment." },
      };
    });
  },
}));

/**
 * Build a per-type content prefill from the current ticket. Returns the
 * partial content shape — the store merges it over the type defaults so
 * missing fields stay safe. Kept local because no other caller needs the
 * exact same coupling between TicketFields and KnowledgeContent.
 */
function buildPrefillContent<T extends KnowledgeItemType>(
  type: T,
  ctx: {
    details: ExtractedDetails;
    fields: TicketFields;
    ticketId: string;
  },
): Partial<KnowledgeContentByType[T]> {
  const { details, fields, ticketId } = ctx;
  const linked = ticketId ? [ticketId] : [];
  switch (type) {
    case "common_problem":
      return {
        category: details.category,
        deviceType: details.deviceType,
        symptoms: details.symptoms ?? [],
        troubleshootingSteps: details.steps ?? [],
        likelyResolution: fields.resolution,
        warnings: details.confidenceNotes ?? [],
        keywords: deriveKeywords(details, fields),
        relatedTicketIds: linked,
      } as unknown as Partial<KnowledgeContentByType[T]>;
    case "troubleshooting_guide":
      return {
        category: details.category,
        deviceType: details.deviceType,
        issue: details.issue,
        symptoms: details.symptoms ?? [],
        steps: details.steps ?? [],
        warnings: details.confidenceNotes ?? [],
        questions: details.suggestedQuestions ?? [],
        keywords: deriveKeywords(details, fields),
        relatedTicketIds: linked,
      } as unknown as Partial<KnowledgeContentByType[T]>;
    case "part_request_rule":
      return {
        deviceType: details.deviceType,
        category: details.category,
        triggerPhrases: derivePartTriggers(details),
        reason: details.replacementReason || "Replacement may be needed.",
        partLabel:
          fields.partRequest?.split(/\n/)[0]?.trim() ||
          (details.deviceType
            ? `replacement ${details.deviceType.toLowerCase()}`
            : "replacement part"),
        excludePhrases: [],
        relatedTicketIds: linked,
      } as unknown as Partial<KnowledgeContentByType[T]>;
    case "escalation_rule":
      return {
        category: details.category,
        deviceType: details.deviceType,
        triggerPhrases: details.symptoms ?? [],
        escalateTo: details.transferDepartment || "Vendor / Tier 2",
        reason: details.escalationNeeded
          ? "Escalation flagged on this call."
          : "Escalation may apply.",
        relatedTicketIds: linked,
      } as unknown as Partial<KnowledgeContentByType[T]>;
    case "store_note":
      return {
        storeNumber: details.storeNumber,
        notes: details.notes,
        relatedTicketIds: linked,
      } as unknown as Partial<KnowledgeContentByType[T]>;
    case "device_note":
      return {
        deviceType: details.deviceType,
        notes: details.notes,
        knownIssues: details.symptoms ?? [],
        relatedTicketIds: linked,
      } as unknown as Partial<KnowledgeContentByType[T]>;
    case "category_mapping":
      return {
        triggerKeywords: deriveKeywords(details, fields),
        category: details.category,
        subCategory: details.subCategory,
        item: details.item,
        relatedTicketIds: linked,
      } as unknown as Partial<KnowledgeContentByType[T]>;
    case "correction_rule":
      return {
        detected: "",
        corrected: "",
        notes: "",
        relatedTicketIds: linked,
      } as unknown as Partial<KnowledgeContentByType[T]>;
  }
  return {} as Partial<KnowledgeContentByType[T]>;
}

function deriveKeywords(details: ExtractedDetails, fields: TicketFields): string[] {
  const out = new Set<string>();
  const push = (s: string | undefined) => {
    if (!s) return;
    const t = s.trim();
    if (t.length >= 3) out.add(t);
  };
  push(details.deviceType);
  push(details.category);
  push(details.subCategory);
  push(details.item);
  for (const d of details.devices ?? []) push(d);
  for (const w of (fields.subject || "").split(/\s+/)) {
    if (w.length >= 4) out.add(w.replace(/[^A-Za-z0-9]/g, ""));
  }
  return [...out].filter(Boolean).slice(0, 8);
}

function derivePartTriggers(details: ExtractedDetails): string[] {
  const out: string[] = [];
  if (details.errorMessage) out.push(details.errorMessage);
  for (const s of details.symptoms ?? []) out.push(s);
  if (details.replacementReason) out.push(details.replacementReason);
  return out.slice(0, 5);
}

/**
 * Phase 11A — one-chunk worker. Encodes the chunk to WAV, writes it to disk,
 * runs whisper.cpp on it, applies transcript repair, classifies the speaker
 * using the prior ready segment as context, and appends the new segment to
 * `liveCapture.segments`. Every chunk produces exactly one segment, even if
 * whisper returns empty text (the segment row stays as evidence of captured
 * audio).
 *
 * Whisper is NOT invoked when chunkSize is "manual" or whisper paths are
 * unset — the segment is appended in `ready` state with empty text so the
 * Live Transcript Viewer can still show the chunk row with a "transcript
 * pending" hint.
 */
async function processLiveChunk(
  chunk: ChunkPayload,
  get: () => AppState,
  set: (
    partial:
      | Partial<AppState>
      | ((s: AppState) => Partial<AppState>),
  ) => void,
): Promise<void> {
  const chunkStartedAt = Date.now();
  const settings = get().settings;
  const persistenceOk = isPersistenceAvailable();
  const whisperConfigured =
    !!settings.whisperExecutablePath.trim() && !!settings.whisperModelPath.trim();
  const liveTranscribeEnabled =
    settings.liveAssist.enableLiveTranscript !== false &&
    settings.liveAssist.chunkSizeSec !== "manual" &&
    whisperConfigured &&
    persistenceOk;

  const placeholder: LiveSegment = {
    id: newId(),
    index: chunk.index,
    audioOffsetMs: chunk.startedAtMs,
    durationMs: chunk.durationMs,
    rawText: "",
    repairedText: "",
    speaker: "unknown",
    confidence: "low",
    userCorrected: false,
    reason: liveTranscribeEnabled
      ? "Transcribing…"
      : !whisperConfigured
        ? "Whisper not configured — transcript pending."
        : "Live transcription disabled.",
    status: liveTranscribeEnabled ? "transcribing" : "ready",
  };
  set((s) => ({
    liveCapture: {
      ...s.liveCapture,
      segments: [...s.liveCapture.segments, placeholder],
      inflightChunks: liveTranscribeEnabled
        ? s.liveCapture.inflightChunks + 1
        : s.liveCapture.inflightChunks,
      chunksAttempted: liveTranscribeEnabled
        ? s.liveCapture.chunksAttempted + 1
        : s.liveCapture.chunksAttempted,
    },
  }));

  if (!liveTranscribeEnabled) return;

  let chunkPath: string | null = null;
  try {
    const encoded = await blobToWav16kMono(chunk.blob);
    const fname = `live-chunk-${chunk.index}-${Date.now()}.wav`;
    chunkPath = await saveAudioFile(fname, encoded.bytes);
    const r = await transcribeAudio({
      audioPath: chunkPath,
      whisperPath: settings.whisperExecutablePath,
      modelPath: settings.whisperModelPath,
      language: settings.whisperLanguage || "en",
      threads: settings.whisperThreads || 4,
      prompt: settings.whisperPrompt || "",
    });
    const rawText = (r.text || "").trim();
    const repaired = rawText
      ? correctTranscript(rawText, {
          dictionary: settings.correctionDictionary,
          applyDictionary: settings.enableTranscriptCorrection !== false,
          applyNumberWords: settings.enableNumberWordNormalization !== false,
          applyDomainRepair: true,
        })
      : { text: "", changes: [] };

    // Phase 16B — classify the chunk BEFORE speaker labeling. Hidden
    // chunks (silence / noise / hallucination / unclear) do not produce
    // a Caller row in the conversation view, do not contribute to the
    // live transcript, and do not trigger caller-name detection. The
    // segment still lands in `segments` so Raw Chunk Debug can show it.
    //
    // Phase 16D — if the user has calibrated the active mic, use the
    // per-device silence/speech thresholds instead of the global
    // constants. Calibration is stored at settings.microphoneCalibrations
    // keyed by deviceId; the "default" key covers the unselected case.
    const audioStats = { peakLevel: encoded.peakLevel, rmsLevel: encoded.rmsLevel };
    const calibrationKey = settings.audioInputDeviceId || "default";
    const calibration = settings.microphoneCalibrations?.[calibrationKey];
    // Phase 16D follow-up — Spread the calibration straight in. The
    // classifier's ClassifierThresholds shape now matches the calibration
    // record 1:1 (silenceRms, speechRms, peakClipping).
    const thresholds = calibration
      ? {
          silenceRms: calibration.silenceRms,
          speechRms: calibration.speechRms,
          peakClipping: calibration.peakClipping,
        }
      : undefined;
    const textVerdict = classifyLiveChunkText(
      repaired.text || rawText,
      audioStats,
      thresholds,
    );
    const isHidden = !textVerdict.shouldShowInConversation;

    const speakerEnabled =
      settings.liveAssist.enableLiveSpeakerDetection !== false && !isHidden;
    const readySegments = get().liveCapture.segments.filter(
      (s) =>
        s.status === "ready" &&
        s.repairedText.trim() &&
        !s.hiddenFromConversation,
    );
    const prev = readySegments[readySegments.length - 1];
    const prevHint: PrevSegmentHint | null = prev
      ? {
          speaker: prev.speaker,
          text: prev.repairedText,
          confidence: prev.confidence,
        }
      : null;
    const classification = speakerEnabled
      ? classifyWithContext(repaired.text, prevHint)
      : isHidden
        ? {
            speaker: "unknown" as const,
            confidence: "low" as const,
            reason: textVerdict.reason,
          }
        : {
            speaker: "unknown" as const,
            confidence: "low" as const,
            reason: "Live speaker detection disabled.",
          };

    set((s) => {
      const segments = s.liveCapture.segments.map((seg) =>
        seg.id === placeholder.id
          ? {
              ...seg,
              rawText,
              repairedText: repaired.text,
              speaker: seg.userCorrected ? seg.speaker : classification.speaker,
              confidence: seg.userCorrected
                ? ("high" as const)
                : classification.confidence,
              reason: seg.userCorrected ? seg.reason : classification.reason,
              status: "ready" as const,
              corrections: repaired.changes,
              noiseKind: textVerdict.kind,
              hiddenFromConversation: isHidden && !seg.userCorrected,
              peakLevel: encoded.peakLevel,
              rmsLevel: encoded.rmsLevel,
            }
          : seg,
      );
      // Caller-name auto-detection. We only mine from non-tech, non-vendor,
      // non-wrong-caller segments (i.e. the caller side of the conversation).
      // A user-typed name freezes the field — we never silently overwrite it.
      //
      // Phase 11B: feed the previous tech segment (if any) into the sequence
      // walker so Q→A detection fires — "May I have your name?" → "Maria."
      // works even though the inline-only path wouldn't catch a bare name.
      //
      // Phase 16B: hidden chunks never contribute to caller-name detection.
      // A whisper hallucination on silence shouldn't be parsed for a name.
      const effectiveSpeaker = classification.speaker;
      const isCallerSide =
        !isHidden &&
        (effectiveSpeaker === "store_employee" ||
          effectiveSpeaker === "store_manager" ||
          effectiveSpeaker === "customer" ||
          effectiveSpeaker === "unknown");
      let detectedCallerName = s.liveCapture.detectedCallerName;
      let callerNameConfidence = s.liveCapture.callerNameConfidence;
      const nextAnswers = { ...s.liveAssistAnswers };
      if (isCallerSide && !s.liveCapture.callerNameUserCorrected) {
        const seqItems: { side: "tech" | "caller"; text: string }[] = [];
        if (prev && prev.speaker === "tech_support") {
          seqItems.push({ side: "tech", text: prev.repairedText });
        }
        seqItems.push({ side: "caller", text: repaired.text });
        const hit = detectCallerNameInSequence(seqItems);
        if (hit) {
          const confRank = (
            c: "high" | "medium" | "review_needed" | "low",
          ): number =>
            c === "high" ? 3 : c === "medium" ? 2 : c === "review_needed" ? 1 : 0;
          const upgrade =
            !detectedCallerName ||
            confRank(hit.confidence) > confRank(callerNameConfidence);
          if (upgrade) {
            detectedCallerName = hit.name;
            callerNameConfidence = hit.confidence;
            // Seed the LiveAssistPanel answer too, but only when there's no
            // user-typed value there yet — that way Live Assist's "Your
            // answers" chip set reflects the auto-detected name without
            // clobbering an explicit user entry.
            if (!nextAnswers.callerName) {
              nextAnswers.callerName = hit.name;
            }
          }
        }
      }
      return {
        liveCapture: {
          ...s.liveCapture,
          segments,
          liveTranscript: buildLiveTranscript(segments),
          inflightChunks: Math.max(0, s.liveCapture.inflightChunks - 1),
          detectedCallerName,
          callerNameConfidence,
          chunksSucceeded: s.liveCapture.chunksSucceeded + 1,
          chunksAcceptedAsSpeech: isHidden
            ? s.liveCapture.chunksAcceptedAsSpeech
            : s.liveCapture.chunksAcceptedAsSpeech + 1,
          chunksIgnored: isHidden
            ? s.liveCapture.chunksIgnored + 1
            : s.liveCapture.chunksIgnored,
          lastUpdateAt: Date.now(),
          lastChunkLatencyMs: Date.now() - chunkStartedAt,
        },
        liveAssistAnswers: nextAnswers,
      };
    });
  } catch (e) {
    const msg = friendlyWhisperError(e);
    set((s) => {
      const segments = s.liveCapture.segments.map((seg) =>
        seg.id === placeholder.id
          ? {
              ...seg,
              status: "failed" as const,
              errorMessage: msg,
              reason: `Chunk transcription failed: ${msg}`,
            }
          : seg,
      );
      return {
        liveCapture: {
          ...s.liveCapture,
          segments,
          inflightChunks: Math.max(0, s.liveCapture.inflightChunks - 1),
          lastError: msg,
          chunksFailed: s.liveCapture.chunksFailed + 1,
        },
      };
    });
  } finally {
    if (chunkPath) {
      deleteAudioFile(chunkPath).catch(() => undefined);
    }
  }
}

/**
 * Tiny formatter for status messages: "today 4:00 PM" / "Tue 9:00 AM" / a
 * short ISO fallback. Lives here (not in formatDate.ts) because no other
 * caller wants exactly this shape.
 */
function formatDueLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `today at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return `${d.toLocaleDateString([], { weekday: "short" })} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

