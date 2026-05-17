import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppStore, type AudioStatus } from "../services/appStore";
import { TranscriptEditor } from "../components/TranscriptEditor";
import { WarningBox } from "../components/WarningBox";
import { LiveAssistPanel } from "../components/LiveAssistPanel";
import { LiveTranscriptViewer } from "../components/LiveTranscriptViewer";
import { FinalReviewCard } from "../components/FinalReviewCard";
import { LiveChunkRecorder } from "../services/liveChunkRecorder";
import { Icon } from "../components/Icon";
import { AudioStatusCard } from "../components/AudioStatusCard";
import { WorkflowSteps } from "../components/WorkflowSteps";
import { Spinner } from "../components/Spinner";
import { useConfirm } from "../components/ConfirmDialog";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { TranscriptQualityCard } from "../components/TranscriptQualityCard";
import { NextStepCard } from "../components/NextStepCard";
import { assessTranscriptQuality } from "../services/transcriptQuality";

const SAMPLE_TRANSCRIPT =
  "Store 9 called because the receipt printer was not printing. I had them restart the POS, checked the USB cable, replaced the cable, and then we ran a test print. It worked after that. Issue resolved.";

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function VoiceTicketPage() {
  const transcript = useAppStore((s) => s.transcript);
  const setTranscript = useAppStore((s) => s.setTranscript);
  const analyze = useAppStore((s) => s.analyzeCurrentTranscript);
  const reset = useAppStore((s) => s.resetWorkflow);
  const busy = useAppStore((s) => s.busy);
  const aiProvider = useAppStore((s) => s.settings.aiProvider);
  const settings = useAppStore((s) => s.settings);
  const audio = useAppStore((s) => s.audio);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  const cancelRecording = useAppStore((s) => s.cancelRecording);
  const pauseRecording = useAppStore((s) => s.pauseRecording);
  const resumeRecording = useAppStore((s) => s.resumeRecording);
  const deleteAudio = useAppStore((s) => s.deleteAudio);
  const transcribeRecording = useAppStore((s) => s.transcribeRecording);
  const navigate = useNavigate();
  const askConfirm = useConfirm();

  const [elapsedMs, setElapsedMs] = useState(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (
      (audio.status !== "recording" && audio.status !== "paused") ||
      !audio.recordingStartedAt
    ) {
      setElapsedMs(0);
      return;
    }
    const startedAt = audio.recordingStartedAt;
    const compute = () => {
      const pausedSlice = audio.pausedAt ? Date.now() - audio.pausedAt : 0;
      const total = Date.now() - startedAt - audio.totalPausedMs - pausedSlice;
      setElapsedMs(total);
    };
    compute();
    if (audio.status === "paused") return;
    const t = window.setInterval(compute, 250);
    return () => window.clearInterval(t);
  }, [audio.status, audio.recordingStartedAt, audio.pausedAt, audio.totalPausedMs]);

  const recorderAvailable = LiveChunkRecorder.isAvailable();
  const whisperConfigured =
    settings.whisperExecutablePath.trim() && settings.whisperModelPath.trim();

  // Phase 16C — transcript quality gate. Same verdict the LiveAssistPanel
  // and the analyze flow use, surfaced here as a card so the user knows
  // up-front whether the transcript is good enough.
  const transcriptVerdict = transcript.trim()
    ? assessTranscriptQuality(transcript)
    : null;
  const [bypassGate, setBypassGate] = useState(false);
  const currentTicketId = useAppStore((s) => s.currentTicketId);
  const generatedTicket = useAppStore((s) => s.generatedTicket);
  // Phase 17C — Daily users get a compact AudioStatusCard and a default-
  // collapsed Live Assist panel. Advanced+ users keep the existing quality-
  // driven auto-expand behavior.
  const userMode = settings.userMode;
  const isDaily = userMode === "daily";
  const stage = useAppStore((s) => s.stage);

  async function onAnalyze() {
    if (!transcript.trim() || busy) return;
    // If the quality gate says no, require an explicit "Analyze Anyway"
    // click before we send the transcript through the AI/analyzer.
    if (
      transcriptVerdict &&
      !transcriptVerdict.shouldAnalyze &&
      !bypassGate
    ) {
      const ok = await askConfirm({
        title: "Analyze anyway?",
        message:
          `Transcript quality is ${transcriptVerdict.quality}. ${transcriptVerdict.warning} ` +
          "Generated fields will be flagged as review-required. Continue anyway?",
        confirmLabel: "Analyze anyway",
        destructive: true,
      });
      if (!ok) return;
      setBypassGate(true);
    }
    await analyze();
    navigate("/form");
  }

  async function onCancelRecording() {
    // If they've been recording for more than 30 seconds, ask before throwing
    // it away — easy to fat-finger Cancel when you meant Stop.
    if (elapsedMs > 30_000) {
      const ok = await askConfirm({
        title: "Discard this recording?",
        message: `You have ${formatElapsed(elapsedMs)} of audio. Cancel will throw it away — Stop keeps it.`,
        destructive: true,
        confirmLabel: "Discard recording",
      });
      if (!ok) return;
    }
    cancelRecording();
  }

  async function onDeleteAudio() {
    const ok = await askConfirm({
      title: "Delete this recording?",
      message:
        "The unsaved recording will be removed. The transcript stays in the editor.",
      destructive: true,
    });
    if (!ok) return;
    await deleteAudio();
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-[11px] font-medium text-brand-700 dark:border-brand-800/70 dark:bg-brand-900/40 dark:text-brand-300">
          <Icon name="mic" className="h-3 w-3" />
          Capture
        </div>
        <h1 className="page-title">New Voice Ticket</h1>
        <p className="page-subtitle">
          Record the call locally and let whisper.cpp transcribe it on this machine — or skip the
          mic and paste the transcript by hand. Either way, nothing leaves the computer.
        </p>
      </header>

      <WorkflowSteps />

      <NextStepCard
        input={{
          hasRecording: !!audio.wavPath && audio.isPersisted,
          isRecording: audio.status === "recording" || audio.status === "paused",
          hasTranscript: !!transcript.trim(),
          transcriptVerdict,
          hasAnalyzed: stage === "details" || stage === "ticket" || stage === "form",
          hasGeneratedFields: !!generatedTicket.trim(),
          hasSavedTicket: !!currentTicketId,
          audioAttached: !!audio.wavPath && audio.isPersisted && !!currentTicketId,
        }}
      />

      <AudioStatusCard compact={isDaily} />

      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="label">Local Recording</div>
            <div className="text-xs text-slate-500">
              {settings.saveAudio
                ? "Audio is saved locally until you delete it."
                : "Audio is kept only until transcription completes, then deleted."}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {recorderAvailable ? (
              whisperConfigured ? (
                <span>
                  whisper.cpp set: {shortPath(settings.whisperExecutablePath)} · model{" "}
                  {shortPath(settings.whisperModelPath)}
                </span>
              ) : (
                <>
                  <span>Set whisper.cpp paths to enable Transcribe.</span>
                  <Link to="/settings" className="btn-ghost h-7 px-2 text-xs">
                    Open Settings
                  </Link>
                </>
              )
            ) : (
              "Microphone unavailable in this environment. Use manual transcript below."
            )}
          </div>
        </div>

        <RecordingControls
          status={audio.status}
          elapsedMs={elapsedMs}
          durationMs={audio.durationMs}
          recorderAvailable={recorderAvailable}
          whisperConfigured={!!whisperConfigured}
          onStart={() => void startRecording()}
          onStop={() => void stopRecording()}
          onCancel={() => void onCancelRecording()}
          onPause={pauseRecording}
          onResume={resumeRecording}
          onTranscribe={() => void transcribeRecording()}
          onDelete={() => void onDeleteAudio()}
        />

        {audio.blobUrl && (
          <div className="space-y-1">
            <audio
              ref={audioElRef}
              controls
              src={audio.blobUrl}
              className="w-full"
            />
            <div className="text-[11px] text-slate-500">
              {audio.isPersisted && audio.wavPath
                ? `Saved at ${shortPath(audio.wavPath)}`
                : "In-memory only (browser preview)."}
            </div>
          </div>
        )}

        {audio.errorMessage && (
          <WarningBox tone="danger" title="Recording problem">
            {audio.errorMessage}
          </WarningBox>
        )}

        {!recorderAvailable && (
          <WarningBox tone="info">
            This webview does not expose <code>getUserMedia</code>. The manual transcript below still
            works as a fallback.
          </WarningBox>
        )}

        {audio.isPersisted && audio.wavPath && (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Icon name="check" className="h-3 w-3" />
            Recording saved locally
          </div>
        )}
      </section>

      <LiveTranscriptViewer />
      <FinalReviewCard />

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="label">Transcript</div>
            <div className="text-xs text-slate-500">
              Edit freely before analysis — whisper output, paste, or hand-typed all work.
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setTranscript(SAMPLE_TRANSCRIPT)}
            >
              Insert sample
            </button>
            <button type="button" className="btn-ghost" onClick={() => reset()}>
              Clear
            </button>
          </div>
        </div>

        <TranscriptEditor
          value={transcript}
          onChange={setTranscript}
          placeholder="e.g. Store 9 called because the receipt printer was not printing..."
          rows={10}
        />

        {transcriptVerdict && (
          <TranscriptQualityCard
            verdict={transcriptVerdict}
            onReRecord={() => void startRecording()}
            onReTranscribe={
              audio.isPersisted ? () => void transcribeRecording() : undefined
            }
            onEdit={() => navigate("/transcript")}
            onAnalyzeAnyway={() => {
              setBypassGate(true);
              void onAnalyze();
            }}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-primary"
            onClick={onAnalyze}
            disabled={!transcript.trim() || busy === "analyzing"}
          >
            {busy === "analyzing" ? "Analyzing…" : "Analyze Transcript"}
          </button>
          <button
            className="btn-secondary"
            onClick={() => navigate("/transcript")}
            disabled={!transcript.trim()}
          >
            Review Transcript
          </button>
          <span className="text-xs text-slate-500">
            {aiProvider === "ollama"
              ? "Analysis runs locally through Ollama. Falls back to rule-based if Ollama is unreachable."
              : "Analysis runs locally with rule-based extraction."}
          </span>
        </div>
      </section>

      <CollapsibleSection
        title="Live Assist"
        description="Detected details, missing-info prompts, and ask-next suggestions."
        expandedByDefault={!isDaily && !!transcriptVerdict?.shouldShowLiveAssist}
      >
        <LiveAssistPanel />
      </CollapsibleSection>

      <CollapsibleSection
        title="Workflow help"
        description="Six-step walkthrough for new users."
      >
        <ol className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            "Record the call (or paste / type the transcript).",
            "Click Transcribe to run whisper.cpp on the recording.",
            "Edit the transcript if needed.",
            "Click Analyze Transcript — fields are extracted locally.",
            "Use Ticket Form Helper to copy each field into your ticket system.",
            "Save the ticket to local history.",
          ].map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-lg border border-slate-200/70 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-800/70 dark:bg-slate-900/40 dark:text-slate-300"
            >
              <span className="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-md bg-brand-600 text-[11px] font-semibold text-white shadow-sm">
                {i + 1}
              </span>
              <span className="leading-snug">{step}</span>
            </li>
          ))}
        </ol>
      </CollapsibleSection>
    </div>
  );
}

interface RecordingControlsProps {
  status: AudioStatus;
  elapsedMs: number;
  durationMs: number;
  recorderAvailable: boolean;
  whisperConfigured: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onTranscribe: () => void;
  onDelete: () => void;
}

function RecordingControls({
  status,
  elapsedMs,
  durationMs,
  recorderAvailable,
  whisperConfigured,
  onStart,
  onStop,
  onCancel,
  onPause,
  onResume,
  onTranscribe,
  onDelete,
}: RecordingControlsProps) {
  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isEncoding = status === "encoding";
  const isReady = status === "ready";
  const isTranscribing = status === "transcribing";
  const isLive = isRecording || isPaused;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!isLive && !isEncoding && (
        <button
          type="button"
          aria-label="Start recording"
          className="btn-primary"
          onClick={onStart}
          disabled={!recorderAvailable || isTranscribing}
          title={recorderAvailable ? "Start recording" : "Microphone unavailable"}
        >
          <Icon name="record" className="h-3.5 w-3.5 text-rose-300" />
          Record
        </button>
      )}
      {isLive && (
        <>
          <button type="button" aria-label="Stop recording and keep audio" className="btn-primary" onClick={onStop}>
            <Icon name="stop" className="h-3.5 w-3.5" />
            Stop
          </button>
          {isRecording ? (
            <button type="button" aria-label="Pause recording" className="btn-secondary" onClick={onPause}>
              <Icon name="pause" className="h-3.5 w-3.5" />
              Pause
            </button>
          ) : (
            <button type="button" aria-label="Resume recording" className="btn-secondary" onClick={onResume}>
              <Icon name="play" className="h-3.5 w-3.5" />
              Resume
            </button>
          )}
          <button
            type="button"
            aria-label="Cancel and discard recording"
            className="btn-ghost"
            onClick={onCancel}
          >
            Cancel
          </button>
          <span
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
              isPaused
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300"
                : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300"
            }`}
          >
            <span className="relative inline-flex h-2 w-2">
              {!isPaused && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-70" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  isPaused ? "bg-amber-500" : "bg-rose-600"
                }`}
              />
            </span>
            {isPaused ? "Paused" : "Recording"} · {formatElapsed(elapsedMs)}
          </span>
        </>
      )}
      {isEncoding && (
        <span className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Spinner className="h-3.5 w-3.5" />
          Encoding to 16 kHz mono WAV…
        </span>
      )}
      {isReady && (
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onTranscribe}
            disabled={!whisperConfigured}
            title={
              whisperConfigured
                ? "Run whisper.cpp on the recording"
                : "Set the whisper.cpp executable + model paths in Settings first."
            }
          >
            <Icon name="sparkle" className="h-3.5 w-3.5" />
            Transcribe
          </button>
          <button
            type="button"
            aria-label="Delete recording"
            className="btn-ghost"
            onClick={onDelete}
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
            Delete audio
          </button>
          <span className="text-xs text-slate-500">Duration {formatElapsed(durationMs)}</span>
        </>
      )}
      {isTranscribing && (
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-300"
        >
          <Spinner className="h-3.5 w-3.5" />
          Running whisper.cpp locally…
        </span>
      )}
    </div>
  );
}

function shortPath(p: string): string {
  if (p.length <= 48) return p;
  return `…${p.slice(-46)}`;
}
