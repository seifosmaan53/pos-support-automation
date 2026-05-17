import { useEffect, useMemo, useRef, useState } from "react";
import type { SavedTicket } from "../types/ticket";
import type { TranscriptVersion } from "../types/audio";
import { audioFilesStore } from "../services/audioFilesStore";
import {
  audioFileToObjectUrl,
  isPersistenceAvailable,
  revealAudioFile,
} from "../services/audioStorage";
import { useAppStore } from "../services/appStore";
import { formatDateTime } from "../utils/formatDate";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  ticket: SavedTicket;
  /** Re-render parent when our actions mutate the ticket / audio metadata. */
  onChange: () => void;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioInspectSection({ ticket, onChange }: Props) {
  const audio = ticket.audioId ? audioFilesStore.get(ticket.audioId) : undefined;
  const settings = useAppStore((s) => s.settings);
  const setStatus = useAppStore((s) => s.setStatus);
  const retranscribe = useAppStore((s) => s.retranscribeTicketAudio);
  const applyVersion = useAppStore((s) => s.applyTranscriptVersionToTicket);
  const deleteAudio = useAppStore((s) => s.deleteTicketAudio);
  const askConfirm = useConfirm();

  const versions = ticket.transcriptVersions ?? [];
  const latest = versions.length > 0 ? versions[versions.length - 1] : null;
  const original =
    versions.find((v) => v.source === "original") ?? null;

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [retranscribing, setRetranscribing] = useState(false);
  const [comparingVersion, setComparingVersion] = useState<string | null>(
    latest && latest.source !== "original" ? latest.id : null,
  );
  const [editedDraft, setEditedDraft] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const compareVersion = useMemo(
    () => versions.find((v) => v.id === comparingVersion) ?? null,
    [versions, comparingVersion],
  );

  // Whisper config check — used to disable Re-transcribe with a clear reason.
  const whisperConfigured =
    settings.whisperExecutablePath.trim() !== "" &&
    settings.whisperModelPath.trim() !== "";

  const audioAvailable = !!audio && !audio.deleted;
  const audioOnDisk = audioAvailable && isPersistenceAvailable();

  // Lazily load the playable object URL only when the user clicks Play, so
  // we don't read the WAV from disk on every Inspect render.
  async function ensureAudioUrl(): Promise<string | null> {
    if (audioUrl) return audioUrl;
    if (!audio || audio.deleted) return null;
    if (!isPersistenceAvailable()) {
      setPlayerError("Audio playback requires the Tauri desktop app.");
      return null;
    }
    setLoadingAudio(true);
    try {
      const url = await audioFileToObjectUrl(audio.path, audio.format);
      setAudioUrl(url);
      setPlayerError(null);
      return url;
    } catch (e) {
      setPlayerError((e as Error).message);
      return null;
    } finally {
      setLoadingAudio(false);
    }
  }

  // Revoke any object URL we made when the component unmounts.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function handlePlay() {
    const url = await ensureAudioUrl();
    if (!url) return;
    const el = audioRef.current;
    if (el) {
      try {
        await el.play();
      } catch (e) {
        setPlayerError((e as Error).message);
      }
    }
  }

  function handleStop() {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
  }

  async function handleReveal() {
    if (!audio) return;
    try {
      await revealAudioFile(audio.path);
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }

  async function handleDelete() {
    if (!audio) return;
    const ok = await askConfirm({
      title: "Delete this audio recording?",
      message:
        "The recording file will be removed from disk, but the saved ticket and its transcript will be preserved.",
      destructive: true,
      confirmLabel: "Delete recording",
    });
    if (!ok) return;
    await deleteAudio(ticket.id);
    setAudioUrl(null);
    onChange();
  }

  async function handleRetranscribe() {
    setRetranscribing(true);
    try {
      const v = await retranscribe(ticket.id);
      if (v) {
        setComparingVersion(v.id);
        onChange();
      }
    } finally {
      setRetranscribing(false);
    }
  }

  async function handleUseVersion(text: string, source: "existing" | "edited") {
    const ok = await askConfirm({
      title: "Apply this transcript and regenerate the ticket?",
      message:
        "Current ticket fields will be regenerated from the new transcript. The previous version is kept in history so you can revert.",
      confirmLabel: "Apply & regenerate",
    });
    if (!ok) return;
    await applyVersion(ticket.id, text, source);
    onChange();
  }

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
      <AudioMetadataPanel
        ticket={ticket}
        audioAvailable={audioAvailable}
        audio={audio}
      />

      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
        <button
          type="button"
          className="rounded bg-slate-700 px-2 py-1 text-xs text-white disabled:opacity-50"
          onClick={handlePlay}
          disabled={!audioOnDisk || loadingAudio}
          title={
            !audioOnDisk
              ? !audio
                ? "No audio recording linked to this ticket."
                : audio.deleted
                  ? "Audio was deleted."
                  : "Audio playback requires the Tauri desktop app."
              : loadingAudio
                ? "Loading…"
                : "Play the recording in-place"
          }
        >
          {loadingAudio ? "Loading…" : "Play Audio"}
        </button>
        <button
          type="button"
          className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          onClick={handleStop}
          disabled={!audioUrl}
        >
          Stop
        </button>
        <button
          type="button"
          className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          onClick={handleReveal}
          disabled={!audioOnDisk}
          title={
            audioOnDisk
              ? "Show the audio file in the file manager."
              : "Reveal requires the Tauri desktop app and an existing audio file."
          }
        >
          Reveal File
        </button>
        <button
          type="button"
          className="rounded border border-emerald-500 px-2 py-1 text-xs text-emerald-700 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-200"
          onClick={handleRetranscribe}
          disabled={!audioOnDisk || retranscribing || !whisperConfigured}
          title={
            !audioOnDisk
              ? "No audio file available to re-transcribe."
              : !whisperConfigured
                ? "whisper.cpp is not configured. Configure it in Settings to re-transcribe audio."
                : retranscribing
                  ? "Running whisper.cpp…"
                  : "Run whisper.cpp on the saved audio. The original transcript is preserved."
          }
        >
          {retranscribing ? "Re-transcribing…" : "Re-transcribe Audio"}
        </button>
        <button
          type="button"
          className="ml-auto rounded bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-50"
          onClick={handleDelete}
          disabled={!audioAvailable}
          title={!audioAvailable ? "No audio file to delete." : "Soft-delete the audio file."}
        >
          Delete Audio
        </button>
      </div>

      {playerError && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
          {playerError}
        </p>
      )}

      {audioUrl && (
        <audio
          ref={audioRef}
          controls
          src={audioUrl}
          className="w-full"
          onError={() => setPlayerError("Audio playback failed.")}
        />
      )}

      {versions.length === 0 ? (
        <p className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px] italic text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
          No transcript versions recorded yet. Re-transcribing the audio will save a new
          version without overwriting the original.
        </p>
      ) : (
        <TranscriptVersionPanel
          versions={versions}
          original={original}
          comparingVersion={compareVersion}
          onSelectCompare={setComparingVersion}
          onKeepOld={() =>
            setStatus({
              kind: "info",
              message: "Kept the existing transcript. No changes were made.",
            })
          }
          onUseExisting={(text) => void handleUseVersion(text, "existing")}
          onStartEdit={(text) => {
            setEditedDraft(text);
            setEditing(true);
          }}
          editing={editing}
          editedDraft={editedDraft}
          setEditedDraft={setEditedDraft}
          onCancelEdit={() => {
            setEditing(false);
            setEditedDraft("");
          }}
          onSaveEdit={() => {
            void handleUseVersion(editedDraft, "edited").then(() => {
              setEditing(false);
              setEditedDraft("");
            });
          }}
        />
      )}

      <button
        type="button"
        className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50"
        onClick={() => {
          if (!latest) return;
          void handleUseVersion(latest.text, "existing");
        }}
        disabled={!latest || latest.source === "original"}
        title={
          latest && latest.source !== "original"
            ? "Use the latest re-transcribed/edited version and re-run extraction."
            : "Re-transcribe the audio first, then this button will run extraction from the new transcript."
        }
      >
        Re-run Extraction from New Transcript
      </button>

      {!whisperConfigured && (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          whisper.cpp is not configured. Configure it in <strong>Settings → Local
          Transcription</strong> to enable re-transcription.
        </p>
      )}
    </div>
  );
}

interface MetadataPanelProps {
  ticket: SavedTicket;
  audioAvailable: boolean;
  audio: ReturnType<typeof audioFilesStore.get>;
}

function AudioMetadataPanel({ ticket, audioAvailable, audio }: MetadataPanelProps) {
  if (!ticket.audioId) {
    return (
      <p className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px] italic text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
        No audio recording was attached to this ticket.
      </p>
    );
  }
  if (!audio) {
    return (
      <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        Ticket references audio ID <code>{ticket.audioId}</code> but the audio_files row was
        not found. The recording may have been removed outside the app.
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Meta label="Status" value={audioAvailable ? "Available" : "Deleted"} />
      <Meta label="Format" value={audio.format} />
      <Meta label="Duration" value={formatDuration(audio.durationMs)} />
      <Meta label="Created" value={formatDateTime(audio.createdAt)} />
      <Meta label="Transcript status" value={audio.transcriptStatus || "—"} />
      <Meta label="File path" value={audio.path} mono />
    </dl>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase text-slate-500">{label}</dt>
      <dd
        className={`break-all text-xs text-slate-700 dark:text-slate-200 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

interface TranscriptVersionPanelProps {
  versions: TranscriptVersion[];
  original: TranscriptVersion | null;
  comparingVersion: TranscriptVersion | null;
  onSelectCompare: (id: string) => void;
  onKeepOld: () => void;
  onUseExisting: (text: string) => void;
  onStartEdit: (text: string) => void;
  editing: boolean;
  editedDraft: string;
  setEditedDraft: (s: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
}

function TranscriptVersionPanel(p: TranscriptVersionPanelProps) {
  const { versions, original, comparingVersion } = p;

  return (
    <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase text-slate-500">
          Transcript versions ({versions.length})
        </span>
        <select
          className="input ml-auto h-7 max-w-[260px] py-0 text-xs"
          value={comparingVersion?.id ?? ""}
          onChange={(e) => p.onSelectCompare(e.target.value)}
        >
          <option value="">Select a version to compare…</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {labelFor(v)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <VersionCard
          title="Original transcript"
          subtitle={original ? formatDateTime(original.createdAt) : "—"}
          text={original?.text ?? ""}
        />
        <VersionCard
          title={
            comparingVersion
              ? `${labelFor(comparingVersion)}`
              : "New / re-transcribed"
          }
          subtitle={comparingVersion ? formatDateTime(comparingVersion.createdAt) : "—"}
          text={comparingVersion?.text ?? "(none selected)"}
          highlight={!!comparingVersion && comparingVersion.id !== original?.id}
        />
      </div>

      {p.editing ? (
        <div className="space-y-2">
          <textarea
            className="input min-h-[120px] w-full font-mono text-xs"
            value={p.editedDraft}
            onChange={(e) => p.setEditedDraft(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50"
              onClick={p.onSaveEdit}
              disabled={!p.editedDraft.trim()}
            >
              Save Edited Transcript & Re-run Extraction
            </button>
            <button
              type="button"
              className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-100"
              onClick={p.onCancelEdit}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-100"
            onClick={p.onKeepOld}
            title="No-op — keep the existing transcript."
          >
            Keep Old Transcript
          </button>
          <button
            type="button"
            className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50"
            onClick={() => comparingVersion && p.onUseExisting(comparingVersion.text)}
            disabled={!comparingVersion}
            title={
              comparingVersion
                ? "Apply this version and re-run extraction."
                : "Pick a version to compare first."
            }
          >
            Use This Version
          </button>
          <button
            type="button"
            className="rounded bg-amber-500 px-2 py-1 text-xs text-white disabled:opacity-50"
            onClick={() => comparingVersion && p.onStartEdit(comparingVersion.text)}
            disabled={!comparingVersion}
            title={
              comparingVersion
                ? "Open the version in an editor before applying."
                : "Pick a version to compare first."
            }
          >
            Edit Before Use
          </button>
        </div>
      )}
    </div>
  );
}

function labelFor(v: TranscriptVersion): string {
  const date = formatDateTime(v.createdAt);
  switch (v.source) {
    case "original":
      return `Original · ${date}`;
    case "whisper":
      return `Whisper · ${date}`;
    case "re-transcribed":
      return `Re-transcribed · ${date}${v.whisperModel ? ` · ${v.whisperModel}` : ""}`;
    case "edited":
      return `Edited · ${date}`;
  }
}

function VersionCard({
  title,
  subtitle,
  text,
  highlight = false,
}: {
  title: string;
  subtitle: string;
  text: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded border p-2 ${
        highlight
          ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-900/20"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase text-slate-500">{title}</span>
        <span className="text-[10px] text-slate-400">{subtitle}</span>
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-200">
        {text || "(empty)"}
      </pre>
    </div>
  );
}
