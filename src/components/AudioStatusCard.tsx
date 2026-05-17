/**
 * Phase 11D — Audio Status card.
 *
 * Single, scannable banner that tells the user exactly what state the audio
 * for the CURRENT ticket is in, plus the one or two most useful next actions.
 * Drops into New Ticket, Form Helper, and History Inspect so the user never
 * has to hunt for "is my recording saved? is it attached?"
 *
 * State derivation (computed in `deriveAudioCardState`):
 *   - no-recording          there's no audio at all, in memory or on disk
 *   - recording-in-progress audio.status === "recording" | "paused"
 *   - encoding              audio.status === "encoding"
 *   - transcribing          audio.status === "transcribing"
 *   - saved-locally         local WAV persisted but ticket not saved yet
 *   - not-attached          local WAV persisted, ticket saved, no audioId
 *                           (= the unattached-audio failure mode we MUST flag)
 *   - attached              ticket has audioId, file still on disk
 *   - audio-deleted         ticket had audioId, file marked deleted
 *   - audio-missing         ticket has audioId but the file is gone
 *   - whisper-not-configured paths empty; relevant when audio exists
 *   - error                 audio.status === "error"
 */

import { useMemo } from "react";
import { useAppStore } from "../services/appStore";
import { audioFilesStore } from "../services/audioFilesStore";
import { ticketStore } from "../services/databaseService";
import { useConfirm } from "./ConfirmDialog";
import { Icon, type IconName } from "./Icon";

export type AudioCardState =
  | "no-recording"
  | "recording-in-progress"
  | "encoding"
  | "transcribing"
  | "saved-locally"
  | "not-attached"
  | "attached"
  | "replace-available"
  | "audio-deleted"
  | "audio-missing"
  | "whisper-not-configured"
  | "error";

interface DerivedState {
  state: AudioCardState;
  title: string;
  detail: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  icon: IconName;
  showSaveToTicket: boolean;
  showReTranscribe: boolean;
  showReplace: boolean;
}

export function AudioStatusCard({
  compact = false,
}: {
  /** Compact mode hides the long subtitle. Use on dense pages. */
  compact?: boolean;
}) {
  const audio = useAppStore((s) => s.audio);
  const currentTicketId = useAppStore((s) => s.currentTicketId);
  const settings = useAppStore((s) => s.settings);
  const transcribeRecording = useAppStore((s) => s.transcribeRecording);
  const saveCurrentTicket = useAppStore((s) => s.saveCurrentTicket);
  const replaceAudioOnCurrentTicket = useAppStore((s) => s.replaceAudioOnCurrentTicket);
  const attachExistingRecording = useAppStore((s) => s.attachExistingRecording);
  const askConfirm = useConfirm();

  async function pickAndAttach() {
    try {
      // Lazy-import the dialog plugin so the test runner (which doesn't have
      // a Tauri runtime) doesn't try to resolve it at module load time.
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Audio",
            extensions: ["wav", "mp3", "m4a", "webm", "ogg"],
          },
        ],
      });
      if (!chosen || typeof chosen !== "string") return;
      await attachExistingRecording(chosen);
    } catch {
      // Browser preview doesn't have the dialog plugin. The button is
      // labelled clearly enough that a failed import is informative.
    }
  }
  const whisperConfigured =
    !!settings.whisperExecutablePath.trim() &&
    !!settings.whisperModelPath.trim();

  // Look up the ticket's audio file row by going through the ticket itself.
  // ticketStore keeps the audioId reference even if the row is later marked
  // deleted, so we can render "audio-deleted" instead of falling back to
  // "no-recording". `getByTicket` would hide deleted rows from us.
  const linkedAudio = useMemo(() => {
    if (!currentTicketId) return undefined;
    const t = ticketStore.get(currentTicketId);
    if (!t?.audioId) return undefined;
    return audioFilesStore.get(t.audioId);
  }, [currentTicketId, audio.wavPath]);

  const derived: DerivedState = deriveAudioCardState({
    audio,
    hasTicket: !!currentTicketId,
    linkedAudioId: linkedAudio?.id ?? null,
    linkedAudioDeleted: !!linkedAudio?.deleted,
    whisperConfigured,
  });

  const styles = TONE_STYLES[derived.tone];

  return (
    <section
      className={`card space-y-2 ${styles.border}`}
      aria-label="Audio status"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg ${styles.iconBg}`}
          >
            <Icon name={derived.icon} className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{derived.title}</h2>
            {!compact && (
              <p className={`mt-0.5 text-xs ${styles.subtitle}`}>{derived.detail}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {derived.showSaveToTicket && (
            <button
              type="button"
              className="btn-primary h-7 px-2 text-xs"
              onClick={() => saveCurrentTicket()}
              title="Save the ticket and attach this recording to it."
            >
              <Icon name="check" className="h-3 w-3" />
              Save Recording to Ticket
            </button>
          )}
          <button
            type="button"
            className="btn-ghost h-7 px-2 text-xs"
            onClick={pickAndAttach}
            title="Pick a WAV / MP3 / M4A / WebM / OGG file from disk and attach it to this ticket."
          >
            <Icon name="copy" className="h-3 w-3" />
            Attach Existing Recording
          </button>
          {derived.showReplace && (
            <button
              type="button"
              className="btn-secondary h-7 px-2 text-xs"
              onClick={async () => {
                const ok = await askConfirm({
                  title: "Replace the attached recording?",
                  message:
                    "This ticket already has a recording. The old recording will be marked deleted (kept in history) and the new local recording will be linked instead.",
                  confirmLabel: "Replace Recording",
                  cancelLabel: "Cancel",
                });
                if (ok) replaceAudioOnCurrentTicket();
              }}
              title="Replace the existing attached recording with the new local recording."
            >
              <Icon name="alertTriangle" className="h-3 w-3" />
              Replace Recording
            </button>
          )}
          {derived.showReTranscribe && (
            <button
              type="button"
              className="btn-secondary h-7 px-2 text-xs"
              onClick={() => transcribeRecording()}
              title="Re-run whisper.cpp on the saved recording and create a new transcript version."
            >
              <Icon name="sparkle" className="h-3 w-3" />
              Re-transcribe
            </button>
          )}
        </div>
      </header>
    </section>
  );
}

interface DeriveInput {
  audio: ReturnType<typeof useAppStore.getState>["audio"];
  hasTicket: boolean;
  linkedAudioId: string | null;
  linkedAudioDeleted: boolean;
  whisperConfigured: boolean;
}

/**
 * Exported for tests. Pure function — no React, no store.
 */
export function deriveAudioCardState(input: DeriveInput): DerivedState {
  const { audio, hasTicket, linkedAudioId, linkedAudioDeleted, whisperConfigured } = input;

  // Live recording lifecycle states take priority — they're transient and
  // the most informative thing to show right now.
  if (audio.status === "recording" || audio.status === "paused") {
    return {
      state: "recording-in-progress",
      title:
        audio.status === "paused"
          ? "Recording paused"
          : "Recording in progress",
      detail:
        "Audio is being captured. The first chunked transcript will appear soon; the final transcript runs after you press Stop.",
      tone: "info",
      icon: "mic",
      showSaveToTicket: false,
      showReTranscribe: false,
      showReplace: false,
    };
  }
  if (audio.status === "encoding") {
    return {
      state: "encoding",
      title: "Encoding recording…",
      detail: "Converting the captured audio to 16 kHz mono WAV.",
      tone: "info",
      icon: "mic",
      showSaveToTicket: false,
      showReTranscribe: false,
      showReplace: false,
    };
  }
  if (audio.status === "transcribing") {
    return {
      state: "transcribing",
      title: "Transcribing recording…",
      detail: "Whisper.cpp is running on the saved audio file.",
      tone: "info",
      icon: "sparkle",
      showSaveToTicket: false,
      showReTranscribe: false,
      showReplace: false,
    };
  }
  if (audio.status === "error") {
    return {
      state: "error",
      title: "Audio error",
      detail: audio.errorMessage || "Something went wrong with the recording.",
      tone: "danger",
      icon: "alertTriangle",
      showSaveToTicket: false,
      showReTranscribe: false,
      showReplace: false,
    };
  }

  // Past-tense states (ready / idle): cross-reference what's saved on disk
  // and what's linked to the ticket to choose between attached / not-attached
  // / deleted / missing / no-recording.
  const hasLocalAudio = audio.isPersisted && !!audio.wavPath;

  if (linkedAudioId && linkedAudioDeleted) {
    return {
      state: "audio-deleted",
      title: "Audio deleted",
      detail:
        "This ticket had a recording, but it's been deleted. Attach a new recording to re-transcribe.",
      tone: "warning",
      icon: "alertTriangle",
      showSaveToTicket: false,
      showReTranscribe: false,
      showReplace: false,
    };
  }
  if (linkedAudioId && !hasLocalAudio) {
    // Ticket has an audio_files row but no in-memory audio loaded. From
    // this component's perspective the audio is attached; whether the file
    // is actually on disk is a separate concern surfaced by inspect views.
    return {
      state: "attached",
      title: "Recording attached to ticket",
      detail:
        "The original recording is saved with this ticket. You can re-transcribe it without re-recording.",
      tone: "success",
      icon: "check",
      showSaveToTicket: false,
      showReTranscribe: whisperConfigured,
      showReplace: false,
    };
  }
  if (linkedAudioId && hasLocalAudio) {
    // Phase 11D — a fresh local recording over an already-attached ticket
    // means the user re-recorded. Surface a "Replace Recording" action and
    // ask the user to confirm before we mark the old row deleted.
    return {
      state: "replace-available",
      title: "New recording — replace existing?",
      detail:
        "This ticket already has a recording attached. The new recording is saved locally but won't be linked until you replace.",
      tone: "warning",
      icon: "alertTriangle",
      showSaveToTicket: false,
      showReTranscribe: whisperConfigured,
      showReplace: true,
    };
  }
  if (hasLocalAudio && hasTicket) {
    // Ticket exists but no audioId — the recording is in memory/on disk but
    // not yet linked. This is the "must flag" case.
    return {
      state: "not-attached",
      title: "Recording not attached to ticket yet",
      detail:
        "You have a local recording. Save the ticket again to attach it, or use Save Recording to Ticket below.",
      tone: "warning",
      icon: "alertTriangle",
      showSaveToTicket: true,
      showReTranscribe: false,
      showReplace: false,
    };
  }
  if (hasLocalAudio && !hasTicket) {
    return {
      state: "saved-locally",
      title: "Recording saved locally",
      detail:
        "The recording is saved to disk. Save this ticket to attach the recording to it.",
      tone: "info",
      icon: "mic",
      showSaveToTicket: true,
      showReTranscribe: false,
      showReplace: false,
    };
  }

  if (audio.blobUrl && !audio.isPersisted && !whisperConfigured) {
    // Recording exists in memory but couldn't be saved; usually means the
    // user is in browser preview rather than the Tauri desktop app.
    return {
      state: "whisper-not-configured",
      title: "Recording in memory only",
      detail:
        "The recording wasn't saved to disk. Run the Tauri desktop app and configure whisper.cpp in Settings to enable persistence and transcription.",
      tone: "warning",
      icon: "alertTriangle",
      showSaveToTicket: false,
      showReTranscribe: false,
      showReplace: false,
    };
  }

  return {
    state: "no-recording",
    title: "No recording",
    detail:
      "Start a recording from the Voice Ticket page, or paste a transcript manually.",
    tone: "neutral",
    icon: "mic",
    showSaveToTicket: false,
    showReTranscribe: false,
    showReplace: false,
  };
}

const TONE_STYLES: Record<
  DerivedState["tone"],
  { border: string; iconBg: string; subtitle: string }
> = {
  info: {
    border: "border-sky-200 dark:border-sky-800/70",
    iconBg: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    subtitle: "text-sky-900/80 dark:text-sky-200/80",
  },
  success: {
    border: "border-emerald-200 dark:border-emerald-800/70",
    iconBg:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    subtitle: "text-emerald-900/80 dark:text-emerald-200/80",
  },
  warning: {
    border: "border-amber-200 dark:border-amber-800/70",
    iconBg:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    subtitle: "text-amber-900/80 dark:text-amber-200/80",
  },
  danger: {
    border: "border-rose-200 dark:border-rose-800/70",
    iconBg: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    subtitle: "text-rose-900/80 dark:text-rose-200/80",
  },
  neutral: {
    border: "border-slate-200/80 dark:border-slate-800/70",
    iconBg:
      "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
    subtitle: "text-slate-500 dark:text-slate-400",
  },
};
