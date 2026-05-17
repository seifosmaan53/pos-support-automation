/**
 * Phase 16B — live chunk text classifier.
 *
 * Whisper, run on a silent or noisy audio chunk, will reliably hallucinate.
 * Common patterns:
 *   • Bracket artifacts the model emits when it doesn't understand —
 *     "[inaudible]", "[ Pause ]", "[SOUND]", "[typing]", "[music]".
 *   • Stock-filler hallucinations on silence — "Thank you.", "Thanks for
 *     watching.", "Okay, that's fine.", "Music", "you".
 *   • Low-information chunks where the only "speech" is a generic "okay"
 *     / "yeah" / "thank you" with no surrounding context.
 *
 * This classifier sits between whisper's output and the live conversation
 * view. Chunks classified as anything but `speech` are flagged to be
 * hidden from the conversation rendering — they still exist on disk and
 * in the segments list (Raw Chunk Debug shows them) but they don't
 * pollute the user-facing transcript with phantom Caller lines.
 *
 * The classifier is intentionally text-first. We use the audio level
 * stats as a tie-breaker for ambiguous cases ("Thank you." is ambiguous
 * on its own — at high audio level it's real, at low level it's
 * almost-certainly a hallucination).
 */

export type ChunkTextKind =
  | "speech"
  | "silence"
  | "noise"
  | "unclear"
  | "hallucination";

export interface AudioStats {
  /** Peak absolute sample level over the chunk, normalized to 0..1. */
  peakLevel?: number;
  /** Root-mean-square sample level over the chunk, normalized to 0..1. */
  rmsLevel?: number;
}

export interface LiveChunkClassification {
  kind: ChunkTextKind;
  shouldShowInConversation: boolean;
  cleanedText: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  /**
   * Phase 16D follow-up — true when the chunk's peak level meets or exceeds
   * the calibrated `peakClipping` (or default 0.95). Independent of `kind`:
   * a clipped chunk is still real speech, but the user should know the
   * mic gain is too hot.
   */
  peakClipping?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants — tuned to keep false-positives low on real speech.
// ────────────────────────────────────────────────────────────────────────────

/** Bracket-artifact pattern. Matches `[anything]`, `(typing)`, `*music*`. */
const BRACKET_ARTIFACT = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;

/** Stock-filler phrases whisper produces on silence/music inputs. */
const HALLUCINATION_PHRASES = new Set<string>([
  "thank you",
  "thank you.",
  "thanks for watching",
  "thanks for watching.",
  "thanks for watching!",
  "thank you for watching",
  "thank you for watching.",
  "music",
  "[music]",
  "you",
  "you.",
  "bye",
  "bye.",
  "subtitles by",
  "subscribe",
  "like and subscribe",
  "please subscribe",
  ".",
  "..",
  "...",
]);

/** Generic single-word / two-word responses that need turn-taking context. */
const GENERIC_RESPONSES = new Set<string>([
  "ok",
  "okay",
  "yes",
  "no",
  "yeah",
  "nope",
  "yep",
  "sure",
  "right",
  "alright",
  "thanks",
  "uh-huh",
  "mm-hmm",
  "got it",
]);

/**
 * Audio level below which a chunk is presumed silent. Tuned on macOS
 * built-in mic recordings — typical speech RMS sits around 0.05–0.2,
 * background hum around 0.005, true silence near 0.
 *
 * Per-device calibration (Phase 16D) can override these at the call site
 * by passing `thresholds` into `classifyLiveChunkText`. Falls back to
 * these defaults when no calibration exists for the active mic.
 */
const SILENCE_RMS = 0.01;
const SILENCE_PEAK = 0.05;
const LOW_LEVEL_RMS = 0.025;

/**
 * Phase 16D — per-device calibration overrides. Each field is optional;
 * missing values fall back to the global constants above. Names align
 * 1:1 with the storage shape at `settings.microphoneCalibrations[deviceId]`
 * so callers can spread the calibration record straight in.
 *
 *   silenceRms    — anything quieter is silence
 *   speechRms     — anything quieter than this is "low audio" (was lowLevelRms)
 *   peakClipping  — peaks at or above this trigger the clipping warning
 *   silencePeak   — peak below this is silent-level (rarely overridden)
 */
export interface ClassifierThresholds {
  silenceRms?: number;
  speechRms?: number;
  peakClipping?: number;
  silencePeak?: number;
}

/** Peak above which a chunk is flagged as clipping (default). */
const PEAK_CLIPPING = 0.95;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function stripBracketArtifacts(text: string): { cleaned: string; bracketCount: number; bracketLen: number } {
  let bracketCount = 0;
  let bracketLen = 0;
  const cleaned = text.replace(BRACKET_ARTIFACT, (match) => {
    bracketCount += 1;
    bracketLen += match.length;
    return " ";
  });
  return { cleaned: cleaned.replace(/\s+/g, " ").trim(), bracketCount, bracketLen };
}

function normalizedPhrase(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function isLowAudio(stats?: AudioStats, t?: ClassifierThresholds): boolean {
  if (!stats) return false;
  const rms = stats.rmsLevel ?? 1;
  const peak = stats.peakLevel ?? 1;
  const speechRms = t?.speechRms ?? LOW_LEVEL_RMS;
  const silencePeak = t?.silencePeak ?? SILENCE_PEAK;
  return rms < speechRms || peak < silencePeak;
}

function isClipping(stats?: AudioStats, t?: ClassifierThresholds): boolean {
  if (!stats) return false;
  const peak = stats.peakLevel ?? 0;
  const clipAt = t?.peakClipping ?? PEAK_CLIPPING;
  return peak >= clipAt;
}

function isSilent(stats?: AudioStats, t?: ClassifierThresholds): boolean {
  if (!stats) return false;
  const rms = stats.rmsLevel ?? 1;
  const peak = stats.peakLevel ?? 1;
  const silenceRms = t?.silenceRms ?? SILENCE_RMS;
  const silencePeak = t?.silencePeak ?? SILENCE_PEAK;
  return rms < silenceRms && peak < silencePeak;
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

/**
 * Classify a single chunk's transcribed text + audio stats. Pure — no
 * side effects, safe to call repeatedly on the same chunk.
 *
 * Returns the kind plus the cleaned text (bracket artifacts removed) so
 * the caller can choose to display the cleaned version even when the
 * chunk is hidden (debug view).
 */
export function classifyLiveChunkText(
  rawText: string,
  audioStats?: AudioStats,
  thresholds?: ClassifierThresholds,
): LiveChunkClassification {
  const text = (rawText ?? "").trim();
  // Phase 16D follow-up — peak clipping is independent of text-classification
  // kind. Compute once, splice into every return so the caller can show a
  // "mic gain too hot" warning regardless of whether the chunk shows in the
  // conversation.
  const clipping = isClipping(audioStats, thresholds);
  const withClipping = (
    v: Omit<LiveChunkClassification, "peakClipping">,
  ): LiveChunkClassification => ({ ...v, peakClipping: clipping });

  // 1. Empty or near-empty.
  if (text.length === 0) {
    return withClipping({
      kind: "silence",
      shouldShowInConversation: false,
      cleanedText: "",
      reason: "Whisper returned no text.",
      confidence: "high",
    });
  }

  // 2. Bracket-artifact-heavy. If most of the text is brackets, treat as
  // noise/unclear regardless of audio level — these tokens never carry
  // ticket-meaningful content.
  const { cleaned, bracketCount, bracketLen } = stripBracketArtifacts(text);
  const cleanedWords = wordCount(cleaned);
  if (bracketCount > 0 && cleanedWords === 0) {
    return withClipping({
      kind: "noise",
      shouldShowInConversation: false,
      cleanedText: "",
      reason: `Only bracket artifacts — ${bracketCount} marker(s) like "[inaudible]" / "[pause]".`,
      confidence: "high",
    });
  }
  if (bracketCount >= 2 && bracketLen >= text.length / 2) {
    return withClipping({
      kind: "unclear",
      shouldShowInConversation: false,
      cleanedText: cleaned,
      reason: "Mostly bracket artifacts — chunk is unclear.",
      confidence: "high",
    });
  }

  // 3. Known stock-filler hallucinations on low / silent audio.
  const normalized = normalizedPhrase(cleaned);
  if (HALLUCINATION_PHRASES.has(normalized)) {
    if (isLowAudio(audioStats, thresholds) || audioStats === undefined) {
      return withClipping({
        kind: "hallucination",
        shouldShowInConversation: false,
        cleanedText: cleaned,
        reason: isSilent(audioStats, thresholds)
          ? "Whisper produced a stock filler phrase on a silent chunk."
          : "Whisper produced a stock filler phrase on a low-level chunk.",
        confidence: "high",
      });
    }
    // Audible: the user might really have said "thank you" at the end of
    // a call. Show but with low confidence.
    return withClipping({
      kind: "speech",
      shouldShowInConversation: true,
      cleanedText: cleaned,
      reason: "Short courtesy phrase — kept (audible).",
      confidence: "low",
    });
  }

  // 4. Generic single-word response on a silent chunk — almost certainly a
  // hallucination. On audible chunks the speaker-detector + Q→A turn-taking
  // can use it; we keep showing in that case.
  if (cleanedWords <= 2 && GENERIC_RESPONSES.has(normalized) && isLowAudio(audioStats, thresholds)) {
    return withClipping({
      kind: "hallucination",
      shouldShowInConversation: false,
      cleanedText: cleaned,
      reason: `Generic short response ("${cleaned}") on a low-level chunk.`,
      confidence: "medium",
    });
  }

  // 5. Silent audio + non-trivial text → likely hallucination. We only
  // hit this when audio stats actually say silent (rms < 0.01 AND peak <
  // 0.05). The user can still see it in Raw Chunk Debug.
  if (isSilent(audioStats, thresholds) && cleanedWords > 0) {
    return withClipping({
      kind: "hallucination",
      shouldShowInConversation: false,
      cleanedText: cleaned,
      reason: "Whisper produced text on a chunk with no measurable audio.",
      confidence: "high",
    });
  }

  // 6. Low-level + short generic text → unclear. Hide by default but with
  // lower confidence so the user can choose to surface via debug.
  if (isLowAudio(audioStats, thresholds) && cleanedWords <= 4) {
    return withClipping({
      kind: "unclear",
      shouldShowInConversation: false,
      cleanedText: cleaned,
      reason: "Low audio level + short text — too unreliable to render as conversation.",
      confidence: "medium",
    });
  }

  // 7. Default: real speech.
  return withClipping({
    kind: "speech",
    shouldShowInConversation: true,
    cleanedText: cleaned,
    reason: "Whisper output looks like real speech.",
    confidence: "high",
  });
}

/**
 * Compute peak + rms levels from a Float32 PCM buffer in [-1, 1]. Used by
 * the audio encoder to surface a quick-and-dirty silence signal to the
 * classifier without re-decoding the WAV.
 */
export function computeAudioStats(samples: Float32Array): AudioStats {
  if (samples.length === 0) {
    return { peakLevel: 0, rmsLevel: 0 };
  }
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const abs = v < 0 ? -v : v;
    if (abs > peak) peak = abs;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return { peakLevel: peak, rmsLevel: rms };
}
