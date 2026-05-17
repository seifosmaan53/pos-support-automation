import type { SpeakerLabel, SpeakerSegment } from "./speaker";
import type { CorrectionChange } from "../services/transcriptCorrector";
import { joinChunksWithOverlapDedup } from "../services/chunkOverlap";

export type LiveCaptureStatus =
  | "idle"
  | "capturing"
  | "finalizing"
  | "review"
  | "error";

export type LiveSegmentStatus =
  | "pending"
  | "transcribing"
  | "ready"
  | "failed";

export interface LiveSegment {
  id: string;
  index: number;
  audioOffsetMs: number;
  durationMs: number;
  rawText: string;
  repairedText: string;
  speaker: SpeakerLabel;
  confidence: SpeakerSegment["confidence"];
  userCorrected: boolean;
  reason: string;
  status: LiveSegmentStatus;
  errorMessage?: string;
  /** User flagged this segment as worth re-reading in the final review. */
  important?: boolean;
  /**
   * User flagged this segment as a wrong transcription. The text stays in the
   * live transcript (so context is preserved) but downstream extraction is
   * told to discount it.
   */
  wrongTranscription?: boolean;
  /** True when the user manually edited `repairedText` (and pinned it). */
  textEdited?: boolean;
  /**
   * Transcript-corrector changes applied to this chunk. Surfaced as
   * "Corrected X → Y" badges with a one-click undo that reverts the segment
   * back to its raw whisper output.
   */
  corrections?: CorrectionChange[];
  /**
   * Phase 16B — classifier verdict from `liveAudioTextFilter`. When
   * `hiddenFromConversation` is true, the Live Conversation view skips
   * this segment but Raw Chunk Debug still shows it. `noiseKind` records
   * why (silence / noise / unclear / hallucination / speech).
   */
  noiseKind?: "speech" | "silence" | "noise" | "unclear" | "hallucination";
  hiddenFromConversation?: boolean;
  /** Audio peak in [0,1] over the chunk. Surfaced in Raw Chunk Debug. */
  peakLevel?: number;
  /** Audio rms in [0,1] over the chunk. Surfaced in Raw Chunk Debug. */
  rmsLevel?: number;
}

export interface LiveCaptureState {
  status: LiveCaptureStatus;
  segments: LiveSegment[];
  liveTranscript: string;
  finalTranscript: string;
  finalTranscriptError: string | null;
  inflightChunks: number;
  lastError: string | null;
  startedAt: number | null;
  /**
   * Bumped by `rerunLiveExtraction` so the LiveAssistPanel re-evaluates its
   * memoized analysis even when the underlying transcript text is unchanged
   * (e.g. after the user re-labels speakers on the Final Review screen).
   */
  extractionVersion: number;
  /**
   * Live-detected caller first name (e.g. "Kaitlyn"). Mined from "this is X" /
   * "my name is X" patterns in incoming segments. Lets the conversation view
   * render "Caller (Kaitlyn)" instead of "Caller (Unknown)" once a name lands,
   * and propagates to extraction without overwriting the original transcript.
   */
  detectedCallerName: string;
  /**
   * Confidence of the auto-detected caller name:
   *   • "high"          — explicit naming phrase ("my name is X", "this is X")
   *                       or a clean answer right after a tech name-question
   *   • "medium"        — "I'm X" / "I am X" patterns (false-positive prone)
   *   • "review_needed" — the captured token is suspect (transcript ended
   *                       with "?" or whisper produced an unclear spelling)
   *   • "low"           — initial empty state (no name yet)
   * "high" is also set whenever `callerNameUserCorrected` flips to true.
   */
  callerNameConfidence: "high" | "medium" | "review_needed" | "low";
  /** True if the user typed the caller name explicitly. Frozen against auto-overwrite. */
  callerNameUserCorrected: boolean;
  /**
   * Phase 11B chunk telemetry. Counted in processLiveChunk; surfaced in
   * the live status strip so the user can tell at a glance whether whisper
   * is keeping up and whether any chunks failed.
   */
  chunksAttempted: number;
  chunksSucceeded: number;
  chunksFailed: number;
  /** Phase 16B — chunks the classifier accepted as real speech. */
  chunksAcceptedAsSpeech: number;
  /** Phase 16B — chunks the classifier hid (silence / noise / hallucination / unclear). */
  chunksIgnored: number;
  /** Epoch ms of the most recent successful transcript append. */
  lastUpdateAt: number | null;
  /** Wall-clock duration in ms of the most recent successful chunk (record → whisper-done). */
  lastChunkLatencyMs: number | null;
}

export const EMPTY_LIVE_CAPTURE: LiveCaptureState = {
  status: "idle",
  segments: [],
  liveTranscript: "",
  finalTranscript: "",
  finalTranscriptError: null,
  inflightChunks: 0,
  lastError: null,
  startedAt: null,
  extractionVersion: 0,
  detectedCallerName: "",
  callerNameConfidence: "low",
  callerNameUserCorrected: false,
  chunksAttempted: 0,
  chunksSucceeded: 0,
  chunksFailed: 0,
  chunksAcceptedAsSpeech: 0,
  chunksIgnored: 0,
  lastUpdateAt: null,
  lastChunkLatencyMs: null,
};

export function buildLiveTranscript(segments: LiveSegment[]): string {
  // Phase 16D — when adjacent chunks share content at their seam (e.g.,
  // chunk 1 ends "May I have your" and chunk 2 starts "have your name?"
  // because the recorder uses a small overlap window), dedupe at the
  // join point so the live transcript doesn't double-count words.
  // joinChunksWithOverlapDedup applies dedup pair-by-pair; chunks that
  // don't share any tail/head are joined with a space.
  const usable = segments
    .filter(
      (s) =>
        s.status === "ready" &&
        s.repairedText.trim().length > 0 &&
        !s.wrongTranscription &&
        !s.hiddenFromConversation,
    )
    .map((s) => s.repairedText.trim());
  return joinChunksWithOverlapDedup(usable);
}

export function formatChunkTimestamp(offsetMs: number): string {
  const totalSec = Math.max(0, Math.floor(offsetMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
