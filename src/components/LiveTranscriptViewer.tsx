import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../services/appStore";
import { formatChunkTimestamp, type LiveSegment } from "../types/live";
import type { SpeakerLabel } from "../types/speaker";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { AudioLevelMeter } from "./AudioLevelMeter";
import { groupSegmentsForDisplay, type SegmentGroup } from "../services/liveSegmentGrouping";
import { highlightFactPhrases } from "../services/factHighlighter";

/**
 * Speakers that are rendered as "Caller (Name)" in the conversation view.
 * These are all the non-tech, non-vendor, non-wrong-caller roles — i.e. the
 * person on the other end of a normal support call. We keep the underlying
 * SpeakerLabel intact (store_employee / store_manager / customer / unknown)
 * so extraction and classification logic is untouched; the "Caller" alias is
 * a display detail only.
 */
function isCallerSide(s: SpeakerLabel): boolean {
  return (
    s === "store_employee" ||
    s === "store_manager" ||
    s === "customer" ||
    s === "unknown"
  );
}

/**
 * Phase 11A — Live Transcript Viewer.
 *
 * Renders one row per LiveSegment from `liveCapture.segments`:
 *   [mm:ss] · Role · Confidence
 *   transcript text (repaired)
 *
 * While the chunk is still transcribing, a spinner replaces the role label
 * and the row reads "transcribing…". Failed chunks show the error inline
 * but do not block the rest of the viewer.
 *
 * Clicking the role label opens an inline popover with the four supported
 * roles (Tech / Store Employee / Store Manager / Unknown). Selecting one
 * calls `setLiveSegmentSpeaker` which marks the segment userCorrected so
 * re-running detection won't undo the manual choice.
 *
 * The header surfaces three states the user needs to be aware of:
 *   • whisper not configured  → "Live transcription unavailable…"
 *   • chunk size = manual     → "Live transcription is set to manual…"
 *   • lag warning             → "10–15 second lag" calibration text
 *
 * No new ticket extraction happens here — Live Assist (the panel below)
 * reads `liveCapture.liveTranscript` directly.
 */

const ROLE_LABEL: Record<SpeakerLabel, string> = {
  tech_support: "Tech Support",
  store_employee: "Store Employee",
  store_manager: "Store Manager",
  vendor: "Vendor",
  customer: "Customer",
  wrong_caller: "Wrong Caller",
  unknown: "Unknown",
};

const ROLE_TONE: Record<SpeakerLabel, string> = {
  tech_support:
    "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
  store_employee:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  store_manager:
    "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
  vendor:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
  customer:
    "border-pink-300 bg-pink-50 text-pink-800 dark:border-pink-700 dark:bg-pink-900/40 dark:text-pink-200",
  wrong_caller:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
  unknown:
    "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};

const CONFIDENCE_LABEL: Record<LiveSegment["confidence"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const CONFIDENCE_TONE: Record<LiveSegment["confidence"], string> = {
  high: "text-emerald-700 dark:text-emerald-300",
  medium: "text-sky-700 dark:text-sky-300",
  low: "text-slate-500 dark:text-slate-400",
};

const ROLE_PICK: SpeakerLabel[] = [
  "tech_support",
  "store_employee",
  "store_manager",
  "vendor",
  "customer",
  "wrong_caller",
  "unknown",
];

export function LiveTranscriptViewer() {
  const liveCapture = useAppStore((s) => s.liveCapture);
  const liveAssistSettings = useAppStore((s) => s.settings.liveAssist);
  const technicianName = useAppStore((s) => s.settings.technicianName.trim());
  // Phase 16D follow-up — surface whether the active mic is calibrated.
  const activeMicId = useAppStore((s) => s.settings.audioInputDeviceId);
  const calibrations = useAppStore((s) => s.settings.microphoneCalibrations);
  const calibrationKey = activeMicId || "default";
  const activeCalibration = calibrations?.[calibrationKey];
  // Phase 17C — Daily mode hides power-tool affordances like Raw Chunk Debug
  // to keep the screen uncluttered for the simple workflow.
  const userMode = useAppStore((s) => s.settings.userMode);
  const whisperConfigured = useAppStore(
    (s) =>
      !!s.settings.whisperExecutablePath.trim() &&
      !!s.settings.whisperModelPath.trim(),
  );
  const setLiveSegmentSpeaker = useAppStore((s) => s.setLiveSegmentSpeaker);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const patchLiveAssist = (
    patch: Partial<typeof liveAssistSettings>,
  ): void => {
    updateSettings({ liveAssist: { ...liveAssistSettings, ...patch } });
  };
  const rerunLiveSpeakerDetection = useAppStore(
    (s) => s.rerunLiveSpeakerDetection,
  );
  const setLiveCallerName = useAppStore((s) => s.setLiveCallerName);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const callerNameDraftDefault = liveCapture.detectedCallerName;
  const [callerDraft, setCallerDraft] = useState(callerNameDraftDefault);
  const [editingCaller, setEditingCaller] = useState(false);
  // Phase 16B — Raw Chunk Debug toggle. Default view (false) shows only the
  // chunks the classifier accepted as speech; debug view (true) shows every
  // chunk including silence/noise/hallucinations so the user can see what's
  // happening when nothing is coming through.
  const [showRawDebug, setShowRawDebug] = useState(false);
  // Re-seed the caller-name draft as the auto-detector lands new hits.
  useEffect(() => {
    if (!editingCaller) setCallerDraft(liveCapture.detectedCallerName);
  }, [liveCapture.detectedCallerName, editingCaller]);

  // Auto-scroll to the latest segment on append.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [liveCapture.segments.length]);

  if (liveCapture.status === "idle") return null;

  const manualMode = liveAssistSettings.chunkSizeSec === "manual";
  const showWhisperWarn = !whisperConfigured && !manualMode;
  const isCapturing = liveCapture.status === "capturing";
  const isFinalizing = liveCapture.status === "finalizing";

  return (
    <section className="card space-y-3 border-rose-200 dark:border-rose-800/70">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <Icon name="mic" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Live Conversation</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Near-real-time preview. Silence / noise / hallucinated chunks
              are filtered out by default — use Raw Chunk Debug to see them.
              The final transcript after Stop is the source of truth.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {liveCapture.segments.length > 0 && (
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-xs"
              onClick={rerunLiveSpeakerDetection}
              title="Re-classify all non-corrected segments using full context."
            >
              Re-run speaker detection
            </button>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
              isCapturing
                ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300"
                : isFinalizing
                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300"
                  : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                isCapturing
                  ? "animate-pulse bg-rose-500"
                  : isFinalizing
                    ? "animate-pulse bg-amber-500"
                    : "bg-slate-400"
              }`}
            />
            {isCapturing
              ? "Recording · live"
              : isFinalizing
                ? "Finalizing transcript…"
                : "Review"}
          </span>
        </div>
      </header>

      {isCapturing && <AudioLevelMeter className="mt-1" />}

      {/* Phase 16B — chunk telemetry. Now splits "accepted as speech" vs
          "ignored" so it's obvious whether live transcription is hearing real
          speech or mostly noise. */}
      {(isCapturing || isFinalizing || liveCapture.chunksAttempted > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
          <span>
            <span className="text-slate-400">Captured:</span>{" "}
            <strong className="font-semibold text-slate-700 dark:text-slate-200">
              {liveCapture.chunksAttempted}
            </strong>
          </span>
          <span>
            · Transcribed:{" "}
            <strong className="font-semibold text-slate-700 dark:text-slate-200">
              {liveCapture.chunksSucceeded}
            </strong>
          </span>
          <span className="text-emerald-700 dark:text-emerald-300">
            · Speech: <strong>{liveCapture.chunksAcceptedAsSpeech}</strong>
          </span>
          {liveCapture.chunksIgnored > 0 && (
            <span
              className="text-amber-700 dark:text-amber-300"
              title="Chunks classified as silence / noise / hallucination / unclear and hidden from the conversation view."
            >
              · Ignored: <strong>{liveCapture.chunksIgnored}</strong>
            </span>
          )}
          {liveCapture.chunksFailed > 0 && (
            <span className="text-rose-700 dark:text-rose-300">
              · Failed: {liveCapture.chunksFailed}
            </span>
          )}
          {liveCapture.inflightChunks > 0 && (
            <span className="text-sky-700 dark:text-sky-300">
              · In flight: {liveCapture.inflightChunks}
            </span>
          )}
          {liveCapture.lastChunkLatencyMs !== null && (
            <span title="Time from chunk arrival to live-transcript append.">
              · last chunk {(liveCapture.lastChunkLatencyMs / 1000).toFixed(1)}s
            </span>
          )}
          {liveCapture.lastUpdateAt && (
            <span title="When the transcript was last appended.">
              · updated <RelativeMoment ms={liveCapture.lastUpdateAt} />
            </span>
          )}
          {userMode !== "daily" && (
            <button
              type="button"
              className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 text-[10px] hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              onClick={() => setShowRawDebug((v) => !v)}
              title="Toggle Raw Chunk Debug — shows every chunk including those hidden from the conversation view."
            >
              {showRawDebug ? "Hide" : "Show"} Raw Chunk Debug
            </button>
          )}
        </div>
      )}

      {showWhisperWarn && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
          Live transcription unavailable. Configure whisper.cpp in Settings or
          paste a transcript manually below.
        </div>
      )}

      {manualMode && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          Live transcription is set to <strong>manual</strong>. The final
          transcript will run after recording stops.
        </div>
      )}

      {liveCapture.lastError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/30 dark:text-rose-200">
          Most recent chunk error: {liveCapture.lastError}
        </div>
      )}

      {/* Identity strip — Tech Support name (from settings) + live-detected caller. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-600 dark:border-slate-800/70 dark:bg-slate-900/40 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
          Tech Support <strong className="font-semibold">({technicianName || "set in Settings"})</strong>
        </span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Caller{" "}
          {editingCaller ? (
            <span className="inline-flex items-center gap-1">
              <input
                autoFocus
                value={callerDraft}
                onChange={(e) => setCallerDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setLiveCallerName(callerDraft);
                    setEditingCaller(false);
                  } else if (e.key === "Escape") {
                    setCallerDraft(liveCapture.detectedCallerName);
                    setEditingCaller(false);
                  }
                }}
                placeholder="e.g. Kaitlyn"
                className="h-6 w-32 rounded border border-slate-300 bg-white px-1.5 text-[11px] font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                className="rounded px-1 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                onClick={() => {
                  setLiveCallerName(callerDraft);
                  setEditingCaller(false);
                }}
                title="Save caller name"
              >
                <Icon name="check" className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <>
              <strong className="font-semibold">
                ({liveCapture.detectedCallerName || "Unknown"})
              </strong>
              <button
                type="button"
                className="rounded p-0.5 opacity-70 hover:bg-slate-100 hover:opacity-100 dark:hover:bg-slate-800"
                onClick={() => {
                  setCallerDraft(liveCapture.detectedCallerName);
                  setEditingCaller(true);
                }}
                title="Edit caller name"
              >
                <Icon name="doc" className="h-3 w-3" />
              </button>
              {liveCapture.detectedCallerName && (
                <span
                  className={`text-[10px] ${
                    liveCapture.callerNameUserCorrected
                      ? "text-emerald-600 dark:text-emerald-400"
                      : liveCapture.callerNameConfidence === "high"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {liveCapture.callerNameUserCorrected
                    ? "✓ corrected"
                    : liveCapture.callerNameConfidence === "high"
                      ? "✓ detected"
                      : "review needed"}
                </span>
              )}
            </>
          )}
        </span>
      </div>

      {/* Phase 16D follow-up — calibration status chip. */}
      <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium ${
            activeCalibration
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400"
          }`}
          title={
            activeCalibration
              ? `silence ≤ ${activeCalibration.silenceRms.toFixed(3)} · speech ≥ ${activeCalibration.speechRms.toFixed(3)} · clipping ≥ ${activeCalibration.peakClipping.toFixed(2)}`
              : "Run Calibrate Microphone in Settings to personalize the silence/speech thresholds for your mic."
          }
        >
          <Icon name="mic" className="h-2.5 w-2.5" />
          Mic calibration:{" "}
          {activeCalibration
            ? `Active for ${activeCalibration.label}`
            : "Not calibrated — using default thresholds"}
        </span>
      </div>

      {/* Phase 11B readability toolbar — quick toggles during a live call.
          Phase 17D hides the toolbar in Daily mode — it's a power-user view
          configurator and clutters the simple workflow. */}
      {userMode !== "daily" && (
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            className={`px-2 py-0.5 transition-colors ${
              liveAssistSettings.viewMode === "compact"
                ? "bg-brand-600 text-white"
                : "bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800"
            }`}
            onClick={() => patchLiveAssist({ viewMode: "compact" })}
            title="Pack segment rows tightly — best while a fast call is in progress."
          >
            Compact
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 transition-colors ${
              liveAssistSettings.viewMode === "detailed"
                ? "bg-brand-600 text-white"
                : "bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800"
            }`}
            onClick={() => patchLiveAssist({ viewMode: "detailed" })}
            title="Show raw text + corrections — best for accuracy review."
          >
            Detailed
          </button>
        </span>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={liveAssistSettings.showConfidence}
            onChange={(e) => patchLiveAssist({ showConfidence: e.target.checked })}
          />
          Confidence
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={liveAssistSettings.showRawText}
            onChange={(e) => patchLiveAssist({ showRawText: e.target.checked })}
          />
          Raw text
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={liveAssistSettings.showCorrections}
            onChange={(e) => patchLiveAssist({ showCorrections: e.target.checked })}
          />
          Corrections
        </label>
      </div>
      )}

      <div
        ref={scrollRef}
        className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 dark:border-slate-800/70 dark:bg-slate-900/40"
      >
        {liveCapture.segments.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
            Listening… first chunk will appear after the chunk window closes.
          </div>
        )}
        {liveCapture.segments.length > 0 &&
          liveCapture.chunksAcceptedAsSpeech === 0 &&
          liveCapture.chunksIgnored > 0 &&
          !showRawDebug && (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="font-medium">
                Listening for clear speech… no clear conversation captured
                yet.
              </div>
              <div>
                {liveCapture.chunksIgnored} chunk(s) processed but ignored as
                silence, noise, or unclear audio. Audio level may be low — move
                closer to the microphone or check the selected input.
              </div>
              <div>
                Click <strong>Show Raw Chunk Debug</strong> above to see what
                whisper is hearing.
              </div>
            </div>
          )}
        {(showRawDebug
          ? groupSegmentsForDisplay(liveCapture.segments)
          : groupSegmentsForDisplay(
              liveCapture.segments.filter((s) => !s.hiddenFromConversation),
            )
        ).map((group) => (
          <SegmentRow
            key={group.leadSegment.id}
            group={group}
            technicianName={technicianName}
            callerName={liveCapture.detectedCallerName}
            viewMode={liveAssistSettings.viewMode}
            showConfidence={liveAssistSettings.showConfidence}
            showRawText={liveAssistSettings.showRawText}
            showCorrections={liveAssistSettings.showCorrections}
            showDebug={showRawDebug}
            activeCalibration={activeCalibration ?? null}
            onPick={(speaker) =>
              group.segmentIds.forEach((id) =>
                setLiveSegmentSpeaker(id, speaker),
              )
            }
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Spec rendering: tech_support → "Tech Support (Seif)". Caller-side roles
 * (store_employee / store_manager / customer / unknown) → "Caller (Name)" or
 * "Caller (Unknown)" when no name is known. Other roles render their plain
 * label. Keeps the SpeakerLabel data model untouched.
 */
function headerLabel(
  s: SpeakerLabel,
  technicianName: string,
  callerName: string,
): string {
  if (s === "tech_support") {
    return technicianName
      ? `Tech Support (${technicianName})`
      : "Tech Support";
  }
  if (isCallerSide(s)) {
    return callerName ? `Caller (${callerName})` : "Caller (Unknown)";
  }
  return ROLE_LABEL[s];
}

function SegmentRow({
  group,
  technicianName,
  callerName,
  viewMode,
  showConfidence,
  showRawText,
  showCorrections,
  showDebug,
  activeCalibration,
  onPick,
}: {
  group: SegmentGroup;
  technicianName: string;
  callerName: string;
  viewMode: "compact" | "detailed";
  showConfidence: boolean;
  showRawText: boolean;
  showCorrections: boolean;
  /** Phase 16B — Raw Chunk Debug mode. Shows classification metadata and
   *  faded styling for hidden segments. */
  showDebug?: boolean;
  /** Phase 16D follow-up — calibration for the active mic. Shown in debug. */
  activeCalibration?: {
    label: string;
    silenceRms: number;
    speechRms: number;
    peakClipping: number;
  } | null;
  onPick: (s: SpeakerLabel) => void;
}) {
  // For single-segment groups (the common case) the existing logic is
  // unchanged. For merged groups we display the joined text and propagate
  // flag toggles + edits across every segment ID in the group; the edit
  // text edit re-writes the LAST segment's text (so the previous fragments
  // remain intact for audit) — see `setLiveSegmentText` call below.
  const segment = group.leadSegment;
  const displayText = group.mergedText;
  const displayRaw = group.mergedRawText;
  const allCorrections = group.segments.flatMap((s) => s.corrections ?? []);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [textEditing, setTextEditing] = useState(false);
  const [textDraft, setTextDraft] = useState(displayText);
  const setLiveSegmentText = useAppStore((s) => s.setLiveSegmentText);
  const toggleImportant = useAppStore((s) => s.toggleLiveSegmentImportant);
  const toggleWrong = useAppStore((s) => s.toggleLiveSegmentWrong);
  const revertCorrections = useAppStore((s) => s.revertLiveSegmentCorrections);

  // Re-seed the draft whenever the merged text changes upstream
  // (e.g. another chunk landed, or a re-run rewrote it) — but never while the
  // user is mid-edit.
  useEffect(() => {
    if (!textEditing) setTextDraft(displayText);
  }, [displayText, textEditing]);

  const ts = formatChunkTimestamp(segment.audioOffsetMs);

  const compact = viewMode === "compact";
  const isLowConf = segment.status === "ready" && segment.confidence === "low";
  // Phase 16B — in Raw Chunk Debug mode, hidden chunks render with a
  // dashed border + muted background so the user can scan and see which
  // chunks the classifier ignored vs. accepted.
  const isHidden = !!segment.hiddenFromConversation;
  const containerClass = [
    `rounded-lg border px-3 ${compact ? "py-1" : "py-2"} transition-colors`,
    isHidden
      ? "border-dashed border-slate-300 bg-slate-50/40 opacity-70 dark:border-slate-700 dark:bg-slate-900/30"
      : segment.wrongTranscription
        ? "border-rose-300 bg-rose-50/70 dark:border-rose-800/60 dark:bg-rose-950/30"
        : segment.important
          ? "border-amber-300 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/30"
          : isLowConf
            ? "border-amber-200/80 bg-white dark:border-amber-800/40 dark:bg-slate-900/70"
            : "border-slate-200/70 bg-white dark:border-slate-800/70 dark:bg-slate-900/70",
  ].join(" ");

  // Keyboard shortcuts: when the row has focus (Tab-to-it), Cmd/Ctrl+1/2/3
  // trigger speaker correction. Scoped to the row's keydown handler so they
  // never interfere with typing in the textarea / picker.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (textEditing) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === "1") {
      e.preventDefault();
      onPick("tech_support");
    } else if (e.key === "2") {
      e.preventDefault();
      onPick("store_employee");
    } else if (e.key === "3") {
      e.preventDefault();
      onPick("store_manager");
    }
  }

  return (
    <div
      className={containerClass}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label="Live segment — use Cmd/Ctrl+1/2/3 to relabel the speaker"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-mono">[{ts}]</span>
        {showDebug && segment.noiseKind && segment.noiseKind !== "speech" && (
          <span
            className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            title={segment.reason}
          >
            ignored · {segment.noiseKind}
          </span>
        )}
        {showDebug && segment.rmsLevel !== undefined && (
          <span
            className="font-mono text-[10px] opacity-70"
            title="peak / rms audio level in [0,1]"
          >
            lvl {(segment.peakLevel ?? 0).toFixed(2)}/{(segment.rmsLevel ?? 0).toFixed(3)}
          </span>
        )}
        {showDebug && (
          <span
            className={`font-mono text-[10px] ${
              activeCalibration
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-slate-500 dark:text-slate-400"
            }`}
            title={
              activeCalibration
                ? `silence ≤ ${activeCalibration.silenceRms.toFixed(3)} · speech ≥ ${activeCalibration.speechRms.toFixed(3)} · clipping ≥ ${activeCalibration.peakClipping.toFixed(2)}`
                : "Defaults: silence ≤ 0.010 · speech ≥ 0.025 · clipping ≥ 0.95"
            }
          >
            cal: {activeCalibration ? "yes" : "no"}
          </span>
        )}
        {showDebug && segment.noiseKind && (
          <span
            className="font-mono text-[10px] opacity-70"
            title={segment.reason}
          >
            kind: {segment.noiseKind}
          </span>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-105 ${ROLE_TONE[segment.speaker]}`}
            title="Click to change the speaker for this segment."
          >
            {segment.status === "transcribing" ? (
              <Spinner className="h-3 w-3" />
            ) : null}
            {headerLabel(segment.speaker, technicianName, callerName)}
            {segment.userCorrected && (
              <Icon name="check" className="h-3 w-3 opacity-80" />
            )}
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 min-w-[10rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {ROLE_PICK.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    onPick(r);
                    setPickerOpen(false);
                  }}
                  className={`block w-full rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
                    r === segment.speaker
                      ? "font-semibold text-brand-700 dark:text-brand-300"
                      : "text-slate-700 dark:text-slate-300"
                  }`}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          )}
        </div>
        {showConfidence && segment.status === "ready" && segment.repairedText.trim() && (
          <span className={`text-[11px] ${CONFIDENCE_TONE[segment.confidence]}`}>
            · {CONFIDENCE_LABEL[segment.confidence]}
          </span>
        )}
        {isLowConf && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200"
            title="Low confidence — review the speaker label or the transcript text."
          >
            <span className="inline-block h-1 w-1 rounded-full bg-amber-500" />
            Review speaker / text
          </span>
        )}
        {segment.status === "transcribing" && (
          <span className="text-[11px] text-sky-700 dark:text-sky-300">· transcribing…</span>
        )}
        {segment.status === "failed" && (
          <span className="text-[11px] text-rose-700 dark:text-rose-300">· failed</span>
        )}
        {segment.textEdited && (
          <span className="text-[11px] text-emerald-700 dark:text-emerald-300">· edited</span>
        )}
        {segment.wrongTranscription && (
          <span className="text-[11px] text-rose-700 dark:text-rose-300">· marked wrong</span>
        )}

        {/* Segment toolbar — only relevant once a chunk is ready. */}
        {segment.status === "ready" && !textEditing && (
          <span className="ml-auto inline-flex items-center gap-1">
            {group.isMerged && (
              <span
                className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                title={`${group.segmentIds.length} chunks merged into this row`}
              >
                ⌘ merged ×{group.segmentIds.length}
              </span>
            )}
            {viewMode === "detailed" && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 dark:border-slate-700 dark:bg-slate-800">⌘1</kbd>
                Tech
                <kbd className="ml-0.5 rounded border border-slate-200 bg-slate-50 px-1 dark:border-slate-700 dark:bg-slate-800">⌘2</kbd>
                Caller
                <kbd className="ml-0.5 rounded border border-slate-200 bg-slate-50 px-1 dark:border-slate-700 dark:bg-slate-800">⌘3</kbd>
                Manager
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setTextDraft(displayText);
                setTextEditing(true);
              }}
              className="rounded p-0.5 opacity-70 hover:bg-slate-100 hover:opacity-100 dark:hover:bg-slate-800"
              title="Edit transcript text for this row."
            >
              <Icon name="doc" className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() =>
                group.segmentIds.forEach((id) => toggleImportant(id))
              }
              className={`rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 ${
                segment.important
                  ? "text-amber-600 opacity-100 dark:text-amber-400"
                  : "opacity-70 hover:opacity-100"
              }`}
              title={segment.important ? "Unmark as important." : "Mark this row as important."}
            >
              <Icon name="sparkle" className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() =>
                group.segmentIds.forEach((id) => toggleWrong(id))
              }
              className={`rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 ${
                segment.wrongTranscription
                  ? "text-rose-600 opacity-100 dark:text-rose-400"
                  : "opacity-70 hover:opacity-100"
              }`}
              title={
                segment.wrongTranscription
                  ? "Unflag wrong transcription."
                  : "Flag this row as wrong transcription — excluded from extraction."
              }
            >
              <Icon name="alertTriangle" className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      <div className="mt-1 text-sm leading-snug text-slate-800 dark:text-slate-100">
        {textEditing ? (
          <div className="space-y-1.5">
            <textarea
              autoFocus
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setTextDraft(displayText);
                  setTextEditing(false);
                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  saveGroupEdit(group, textDraft, setLiveSegmentText);
                  setTextEditing(false);
                }
              }}
              rows={Math.min(6, Math.max(2, Math.ceil(textDraft.length / 60)))}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-[13px] leading-snug shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100"
            />
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  saveGroupEdit(group, textDraft, setLiveSegmentText);
                  setTextEditing(false);
                }}
                className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-1 font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
                disabled={!textDraft.trim()}
              >
                <Icon name="check" className="h-3 w-3" />
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setTextDraft(displayText);
                  setTextEditing(false);
                }}
                className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <span className="text-[10px] text-slate-400">
                Cmd/Ctrl+Enter to save · Esc to cancel
              </span>
            </div>
          </div>
        ) : segment.status === "ready" && displayText.trim() ? (
          <span className={segment.wrongTranscription ? "line-through opacity-70" : ""}>
            {highlightFactPhrases(displayText).map((sp, i) =>
              sp.kind === "fact" ? (
                <mark
                  key={i}
                  className="rounded bg-emerald-100/80 px-0.5 font-semibold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                >
                  {sp.text}
                </mark>
              ) : (
                <span key={i}>{sp.text}</span>
              ),
            )}
          </span>
        ) : segment.status === "transcribing" ? (
          <span className="text-slate-400 dark:text-slate-500">Transcribing chunk…</span>
        ) : segment.status === "failed" ? (
          <span className="text-rose-700 dark:text-rose-300">
            {segment.errorMessage || "Transcription failed for this chunk."}
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">
            Audio segment captured · transcript pending.
          </span>
        )}
      </div>
      {showRawText &&
        segment.status === "ready" &&
        !textEditing &&
        displayRaw.trim() &&
        displayRaw.trim() !== displayText.trim() && (
          <div className="mt-1 text-[11px] text-slate-400 line-through dark:text-slate-500">
            {displayRaw}
          </div>
        )}

      {/* Correction notices: "Corrected story → store" etc. with one-click undo. */}
      {showCorrections &&
        segment.status === "ready" &&
        !textEditing &&
        allCorrections.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {allCorrections.slice(0, 6).map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-300"
                title={`Source: ${c.source}`}
              >
                Corrected <span className="font-mono">{c.from}</span> →{" "}
                <span className="font-mono font-semibold">{c.to}</span>
              </span>
            ))}
            {allCorrections.length > 6 && (
              <span className="text-[10px] text-slate-400">
                +{allCorrections.length - 6} more
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                group.segmentIds.forEach((id) => revertCorrections(id))
              }
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Undo all corrections on this row — restores the raw whisper output."
            >
              <Icon name="arrowRight" className="h-2.5 w-2.5 rotate-180" />
              Undo
            </button>
          </div>
        )}
    </div>
  );
}

/**
 * Renders a human-readable "Nm ago" / "just now" string for a past timestamp,
 * refreshing every 10 s so the value doesn't go stale while the panel sits
 * on screen during a long call.
 */
function RelativeMoment({ ms }: { ms: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);
  // tick is used as a freshness dependency so the diff re-renders even
  // though we don't read its value directly.
  void tick;
  const ageSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (ageSec < 5) return <span className="text-emerald-600 dark:text-emerald-400">just now</span>;
  if (ageSec < 60) return <span>{ageSec}s ago</span>;
  const m = Math.floor(ageSec / 60);
  if (m < 60) return <span>{m}m ago</span>;
  return <span>{Math.floor(m / 60)}h ago</span>;
}

/**
 * When an edit lands on a merged row, write the new text to the LAST
 * segment in the group and zero out every preceding segment's repairedText.
 * This way the row reads exactly the edited text and there's no stale
 * fragment leaking into the joined liveTranscript downstream.
 */
function saveGroupEdit(
  group: SegmentGroup,
  draft: string,
  setText: (id: string, text: string) => void,
) {
  const cleaned = draft.trim();
  group.segments.forEach((seg, idx) => {
    if (idx === group.segments.length - 1) {
      setText(seg.id, cleaned);
    } else {
      setText(seg.id, "");
    }
  });
}
