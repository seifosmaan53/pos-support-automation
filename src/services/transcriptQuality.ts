/**
 * Phase 16C — transcript quality gate.
 *
 * Looks at a full transcript (live preview, final whisper output, or
 * pasted text) and decides whether it carries enough signal to drive
 * Live Assist, Knowledge Base matching, device-specific ask-next, and
 * confident ticket generation.
 *
 * The classifier in `liveAudioTextFilter.ts` runs per-chunk and decides
 * whether a chunk lands in the Live Conversation view. This module runs
 * over the whole transcript and decides whether *downstream extraction
 * should trust it at all*.
 *
 * Verdict scale:
 *   • good   → run everything confidently
 *   • usable → run extraction, but tag fields as review-needed
 *   • poor   → hide Live Assist cards + KB + device-specific prompts
 *   • bad    → block confident analysis entirely, only generic intake
 *              prompts allowed
 *
 * Audio stats (peak / rms in [0,1]) are optional. When present they
 * promote silent-audio + suspicious-text cases to higher severity.
 */
import type { AudioStats } from "./liveAudioTextFilter";

export type TranscriptQuality = "good" | "usable" | "poor" | "bad";

export interface QualityVerdict {
  quality: TranscriptQuality;
  shouldAnalyze: boolean;
  shouldShowLiveAssist: boolean;
  shouldShowKnowledge: boolean;
  shouldShowDeviceSpecificPrompts: boolean;
  reasons: string[];
  usefulWordCount: number;
  artifactCount: number;
  artifactRatio: number;
  warning: string;
  /** True when the transcript clearly contains a recognizable store number. */
  hasStoreNumber: boolean;
  /** True when the transcript contains an issue keyword (e.g., "not working"). */
  hasIssueSignal: boolean;
}

export interface QualityOptions {
  audioStats?: AudioStats;
}

// ────────────────────────────────────────────────────────────────────────────
// Patterns
// ────────────────────────────────────────────────────────────────────────────

const BRACKET_ARTIFACT = /\[[^\]]*\]/g;

/** Tokens whisper emits when it doesn't understand. Lowercased for matching. */
const ARTIFACT_TOKENS = new Set<string>([
  "[inaudible]",
  "[pause]",
  "[ pause ]",
  "[sound]",
  "[typing]",
  "[music]",
  "[silence]",
  "[blank_audio]",
  "[blank audio]",
  "[noise]",
  "[clicking]",
  "[coughing]",
  "[laughter]",
]);

/** Common whisper hallucination phrases produced on silent / music input. */
const HALLUCINATION_PHRASES = [
  "link in the description",
  "subscribe",
  "thanks for watching",
  "thank you for watching",
  "like and subscribe",
  "see you in the next video",
  "see you next time",
  "see ya",
  "music",
  "[music]",
];

/** Issue-indicator keywords. Presence suggests this is a real support call. */
const ISSUE_KEYWORDS = [
  "not working",
  "not printing",
  "won't print",
  "won't turn on",
  "won't power",
  "broken",
  "frozen",
  "freeze",
  "error",
  "issue",
  "problem",
  "down",
  "offline",
  "stopped",
  "crashed",
  "won't",
  "can't",
  "cannot",
  "doesn't work",
  "does not work",
  "missing",
  "lost",
  "stuck",
  "failing",
  "failure",
  "hardware",
  "replace",
  "replacement",
];

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function countArtifacts(text: string): { count: number; lengthRemovedChars: number } {
  let count = 0;
  let len = 0;
  text.replace(BRACKET_ARTIFACT, (match) => {
    count += 1;
    len += match.length;
    return "";
  });
  return { count, lengthRemovedChars: len };
}

function stripArtifacts(text: string): string {
  return text.replace(BRACKET_ARTIFACT, " ").replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

function findStoreNumber(text: string): boolean {
  return /\bstore\s+(?:#\s*)?\d{1,5}\b/i.test(text);
}

function findIssueSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return ISSUE_KEYWORDS.some((k) => lower.includes(k));
}

function looksLikeHallucination(text: string): boolean {
  const lower = text.toLowerCase();
  return HALLUCINATION_PHRASES.some((p) => lower.includes(p));
}

function isLowAudio(stats?: AudioStats): boolean {
  if (!stats) return false;
  const rms = stats.rmsLevel ?? 1;
  const peak = stats.peakLevel ?? 1;
  return rms < 0.025 || peak < 0.05;
}

// ────────────────────────────────────────────────────────────────────────────
// Verdict messages
// ────────────────────────────────────────────────────────────────────────────

const WARNINGS: Record<TranscriptQuality, string> = {
  good: "Transcript looks good enough to analyze.",
  usable: "Transcript is usable, but review recommended.",
  poor: "Transcript has limited usable speech. Review or edit before analyzing.",
  bad: "This transcript is not reliable enough to generate a ticket.",
};

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

export function assessTranscriptQuality(
  text: string,
  opts: QualityOptions = {},
): QualityVerdict {
  const reasons: string[] = [];
  const audioStats = opts.audioStats;
  const lowAudio = isLowAudio(audioStats);

  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) {
    return {
      quality: "bad",
      shouldAnalyze: false,
      shouldShowLiveAssist: false,
      shouldShowKnowledge: false,
      shouldShowDeviceSpecificPrompts: false,
      reasons: ["Transcript is empty."],
      usefulWordCount: 0,
      artifactCount: 0,
      artifactRatio: 0,
      warning: WARNINGS.bad,
      hasStoreNumber: false,
      hasIssueSignal: false,
    };
  }

  const artifactInfo = countArtifacts(trimmed);
  const artifactCount = artifactInfo.count;
  const cleaned = stripArtifacts(trimmed);
  const usefulWordCount = countWords(cleaned);
  const totalTokens = usefulWordCount + artifactCount;
  const artifactRatio = totalTokens === 0 ? 1 : artifactCount / totalTokens;
  const hasStoreNumber = findStoreNumber(cleaned);
  const hasIssueSignal = findIssueSignal(cleaned);
  const hallucinationDetected = looksLikeHallucination(cleaned);

  // Build reasons (in priority order — most-important first)
  if (artifactCount > 0 && usefulWordCount === 0) {
    reasons.push(`Only ${artifactCount} bracket artifact(s) and no real speech.`);
  } else if (artifactRatio >= 0.5) {
    reasons.push(
      `Bracket-artifact ratio is ${(artifactRatio * 100).toFixed(0)}% (${artifactCount} of ${totalTokens} tokens).`,
    );
  } else if (artifactCount >= 3) {
    reasons.push(`Contains ${artifactCount} bracket artifact(s).`);
  }
  if (hallucinationDetected) {
    reasons.push("Contains phrasing typical of whisper hallucinations on silent / music audio.");
  }
  if (lowAudio && usefulWordCount > 0) {
    reasons.push("Audio level was low — text may be hallucinated.");
  }
  if (!hasStoreNumber) reasons.push("No store number detected.");
  if (!hasIssueSignal) reasons.push("No issue/symptom keywords detected.");
  if (usefulWordCount < 5) {
    reasons.push(`Only ${usefulWordCount} useful word(s) of speech.`);
  }

  // Verdict — work from "most obviously bad" to "fine".
  let quality: TranscriptQuality;

  if (usefulWordCount === 0) {
    quality = "bad";
  } else if (artifactCount > 0 && usefulWordCount < 5) {
    quality = "bad";
  } else if (hallucinationDetected && (lowAudio || (!hasStoreNumber && !hasIssueSignal))) {
    quality = "bad";
  } else if (usefulWordCount < 5) {
    quality = "bad";
  } else if (artifactRatio >= 0.5 && !hasStoreNumber) {
    quality = "bad";
  } else if (
    // Phase 16C — both story-level anchors (store + issue) override the
    // high-artifact-ratio rule. Test 5 — "[Pause] [SOUND] Store 1518.
    // [inaudible] keyboard not working." — has a 38% artifact ratio but
    // both anchors landed cleanly. That's "usable but noisy", not "poor".
    (artifactRatio >= 0.3 && !(hasStoreNumber && hasIssueSignal)) ||
    (lowAudio && usefulWordCount < 30) ||
    (!hasStoreNumber && !hasIssueSignal && usefulWordCount < 25)
  ) {
    quality = "poor";
  } else if (hasStoreNumber && hasIssueSignal && usefulWordCount >= 30 && artifactRatio < 0.1) {
    quality = "good";
  } else {
    quality = "usable";
  }

  // Promote "usable" to "poor" when low audio + no store + no issue — Phase 16C
  // wants Test 3 (silence-hallucinated printer chatter) to land here. The
  // signal is the absence of *any* anchor (store/issue/audio).
  if (quality === "usable" && lowAudio && !hasStoreNumber && !hasIssueSignal) {
    quality = "poor";
  }

  const shouldAnalyze = quality === "good" || quality === "usable";
  // We surface Live Assist captured-detail cards only for good/usable. Poor
  // is the boundary case — hide cards, but keep generic intake prompts.
  const shouldShowLiveAssist = shouldAnalyze;
  const shouldShowKnowledge = shouldAnalyze;
  // Device-specific prompts ("Does the printer lose power when moved?") only
  // fire when both story-level anchors are present AND the transcript is
  // actually carrying real text.
  const shouldShowDeviceSpecificPrompts =
    quality === "good" || (quality === "usable" && hasStoreNumber && hasIssueSignal);

  return {
    quality,
    shouldAnalyze,
    shouldShowLiveAssist,
    shouldShowKnowledge,
    shouldShowDeviceSpecificPrompts,
    reasons,
    usefulWordCount,
    artifactCount,
    artifactRatio: Math.round(artifactRatio * 1000) / 1000,
    warning: WARNINGS[quality],
    hasStoreNumber,
    hasIssueSignal,
  };
}

/**
 * Test-friendly helper to expose the artifact-token set so unit tests can
 * confirm the exact bracket markers Phase 16C is filtering.
 */
export const __ARTIFACT_TOKENS = ARTIFACT_TOKENS;
