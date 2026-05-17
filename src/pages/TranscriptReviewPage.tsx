import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { TranscriptEditor } from "../components/TranscriptEditor";
import { WarningBox } from "../components/WarningBox";
import { CopyButton } from "../components/CopyButton";
import { SpeakerSegmentEditor } from "../components/SpeakerSegmentEditor";
import { CorrectionReview } from "../components/CorrectionReview";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";

export function TranscriptReviewPage() {
  const transcript = useAppStore((s) => s.transcript);
  const setTranscript = useAppStore((s) => s.setTranscript);
  const analyze = useAppStore((s) => s.analyzeCurrentTranscript);
  const audio = useAppStore((s) => s.audio);
  const transcribeRecording = useAppStore((s) => s.transcribeRecording);
  const settings = useAppStore((s) => s.settings);
  const busy = useAppStore((s) => s.busy);
  const corrections = useAppStore((s) => s.corrections);
  const cleanedTranscript = useAppStore((s) => s.cleanedTranscript);
  const recordCorrectionResolution = useAppStore((s) => s.recordCorrectionResolution);
  const speakerSegments = useAppStore((s) => s.speakerSegments);
  const setSpeakerLabel = useAppStore((s) => s.setSpeakerLabel);
  const bulkSetSpeakerLabels = useAppStore((s) => s.bulkSetSpeakerLabels);
  const alternateSpeakers = useAppStore((s) => s.alternateSpeakers);
  const saveSpeakerCorrections = useAppStore((s) => s.saveSpeakerCorrections);
  const reanalyze = useAppStore((s) => s.reanalyzeWithSpeakerCorrections);
  const navigate = useNavigate();
  const [speakerOpen, setSpeakerOpen] = useState(false);
  const correctedCount = speakerSegments.filter((s) => s.userCorrected).length;

  const canRetranscribe =
    audio.status === "ready" &&
    !!audio.wavPath &&
    !!settings.whisperExecutablePath.trim() &&
    !!settings.whisperModelPath.trim();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Transcript Review</h1>
          <p className="page-subtitle">
            Editing the transcript here improves extraction. Voice recognition can mishear
            words — fix anything important before analyzing.
          </p>
        </div>
      </header>

      {!transcript.trim() && (
        <EmptyState
          icon="quote"
          title="No transcript yet"
          description="Record a call or paste a transcript on Voice Ticket, then come back to review it before extraction."
          cta={{ label: "Open Voice Ticket", to: "/voice" }}
          secondary={
            <>
              Tip: <kbd>Cmd</kbd> / <kbd>Ctrl</kbd>+<kbd>Enter</kbd> analyzes from anywhere.
            </>
          }
        />
      )}

      {transcript.trim() && (
        <section className="card space-y-3">
          <TranscriptEditor value={transcript} onChange={setTranscript} rows={14} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-primary"
              onClick={async () => {
                if (!transcript.trim() || busy) return;
                await analyze();
                navigate("/form");
              }}
              disabled={!transcript.trim() || busy === "analyzing"}
              title="Cmd/Ctrl+Enter"
            >
              {busy === "analyzing" ? (
                <>
                  <Spinner className="h-3.5 w-3.5" />
                  Analyzing…
                </>
              ) : (
                "Analyze Transcript"
              )}
            </button>
            <CopyButton
              text={transcript}
              label="Copy Transcript"
              className="btn-secondary"
            />
            <button
              className="btn-secondary"
              onClick={() => void transcribeRecording()}
              disabled={!canRetranscribe || audio.status === "transcribing"}
              title={
                canRetranscribe
                  ? "Run whisper.cpp on the saved recording again"
                  : "Available when a saved recording exists and whisper.cpp is configured"
              }
            >
              {audio.status === "transcribing" ? (
                <>
                  <Spinner className="h-3.5 w-3.5" />
                  Re-transcribing…
                </>
              ) : (
                "Re-transcribe"
              )}
            </button>
            <button
              className="btn-ghost"
              onClick={() => setTranscript("")}
              disabled={!transcript.trim()}
            >
              Clear
            </button>
            <span className="ml-auto text-[11px] text-slate-500">
              <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> to analyze
            </span>
          </div>
        </section>
      )}

      {corrections.length > 0 && (
        <section className="card space-y-2">
          <CorrectionReview
            changes={corrections}
            cleanedTranscript={cleanedTranscript}
            onApplyResolved={(next) => setTranscript(next)}
            onResolve={(approved, undone) =>
              recordCorrectionResolution(approved, undone)
            }
          />
        </section>
      )}

      {speakerSegments.length > 0 && (
        <section className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Speakers</h2>
              <p className="text-xs text-slate-500">
                Heuristic detection. Correct any wrong labels — extraction will treat
                store-employee text as the source of facts (store #, error, register #)
                and tech-support text as troubleshooting steps.
              </p>
            </div>
            <button
              className="btn-ghost text-sm"
              onClick={() => setSpeakerOpen((v) => !v)}
            >
              {speakerOpen
                ? "Hide speakers"
                : `Show speakers (${speakerSegments.length} segment${speakerSegments.length === 1 ? "" : "s"})`}
            </button>
          </div>
          {speakerOpen && (
            <>
              <SpeakerSegmentEditor
                segments={speakerSegments}
                onChange={setSpeakerLabel}
                onBulkChange={bulkSetSpeakerLabels}
                onAlternate={alternateSpeakers}
                onSaveCorrections={saveSpeakerCorrections}
                onRerunExtraction={async () => {
                  await reanalyze();
                  navigate("/form");
                }}
                rerunDisabled={busy === "analyzing"}
                rerunBusy={busy === "analyzing"}
              />
              {correctedCount > 0 && (
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  {correctedCount} segment{correctedCount === 1 ? "" : "s"} corrected.
                  Click <strong>Save Speaker Corrections</strong> to lock them in or
                  <strong> Re-run Extraction</strong> to rebuild the ticket.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <WarningBox tone="info" title="What happens after analyze">
        After clicking Analyze, you'll land on the <strong>Ticket Form Helper</strong> with every
        field filled in. Yellow badges mark fields the analyzer flagged as missing or unclear so
        you know what to confirm before submitting.
      </WarningBox>
    </div>
  );
}
