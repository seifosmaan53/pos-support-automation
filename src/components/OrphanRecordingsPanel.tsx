import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { audioFilesStore } from "../services/audioFilesStore";
import { useConfirm } from "./ConfirmDialog";
import {
  audioFileToObjectUrl,
  deleteAudioFile,
  isPersistenceAvailable,
  listAudioFilesOnDisk,
  revealAudioFile,
  type OnDiskAudioFile,
} from "../services/audioStorage";
import { formatDateTime } from "../utils/formatDate";
import { WarningBox } from "./WarningBox";

/**
 * Surfaces WAV files that are physically present in the audio directory but
 * have no row in the SQLite `audio_files` table (or have a row that's been
 * soft-deleted). These are recordings the user made and never linked to a
 * saved ticket — typically because they recorded, didn't click Save Ticket,
 * and then closed the app or started a new recording.
 *
 * "Restore" loads the file into the global audio state exactly like a fresh
 * stop-recording would. From there the user can transcribe and save a
 * ticket; the next save will create the audio_files row and link it.
 */
export function OrphanRecordingsPanel() {
  const [open, setOpen] = useState(false);
  const [orphans, setOrphans] = useState<OnDiskAudioFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadOrphan = useAppStore((s) => s.loadOrphanedRecording);
  const setStatus = useAppStore((s) => s.setStatus);
  const askConfirm = useConfirm();

  const persistenceAvailable = useMemo(() => isPersistenceAvailable(), []);

  async function refresh() {
    if (!persistenceAvailable) {
      setOrphans([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const onDisk = await listAudioFilesOnDisk();
      // A row with deleted=true means the user removed the audio explicitly,
      // so we still treat it as orphaned (the SQLite row exists but the file
      // shouldn't be playable anymore — yet here it is on disk). A row with
      // deleted=false means it's properly linked to a ticket; not orphaned.
      const linkedActivePaths = new Set(
        audioFilesStore
          .list()
          .filter((m) => !m.deleted)
          .map((m) => m.path),
      );
      const unlinked = onDisk.filter((f) => !linkedActivePaths.has(f.path));
      setOrphans(unlinked);
    } catch (e) {
      setError((e as Error).message);
      setOrphans([]);
    } finally {
      setLoading(false);
    }
  }

  // Load on first open so we don't pay the IPC cost for users who never
  // expand the panel. Re-run when re-opened.
  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Revoke any object URL when we unmount or change the playing track.
  useEffect(() => {
    return () => {
      if (playingUrl) URL.revokeObjectURL(playingUrl);
    };
  }, [playingUrl]);

  async function play(file: OnDiskAudioFile) {
    if (playingUrl) URL.revokeObjectURL(playingUrl);
    try {
      const url = await audioFileToObjectUrl(file.path, "wav");
      setPlayingPath(file.path);
      setPlayingUrl(url);
    } catch (e) {
      setStatus({
        kind: "error",
        message: `Could not play ${file.filename}: ${(e as Error).message}`,
      });
    }
  }

  async function reveal(file: OnDiskAudioFile) {
    try {
      await revealAudioFile(file.path);
    } catch (e) {
      setStatus({
        kind: "error",
        message: `Could not reveal ${file.filename}: ${(e as Error).message}`,
      });
    }
  }

  async function restore(file: OnDiskAudioFile) {
    await loadOrphan(file.path);
    navigate("/voice");
  }

  async function remove(file: OnDiskAudioFile) {
    const ok = await askConfirm({
      title: "Delete this recording?",
      message: (
        <>
          <span className="font-mono">{file.filename}</span> will be permanently
          removed from disk. This cannot be undone.
        </>
      ),
      destructive: true,
      confirmLabel: "Delete file",
    });
    if (!ok) return;
    try {
      await deleteAudioFile(file.path);
      if (playingPath === file.path && playingUrl) {
        URL.revokeObjectURL(playingUrl);
        setPlayingPath(null);
        setPlayingUrl(null);
      }
      setOrphans((cur) => cur.filter((f) => f.path !== file.path));
      setStatus({ kind: "success", message: `Deleted ${file.filename}.` });
    } catch (e) {
      setStatus({
        kind: "error",
        message: `Could not delete ${file.filename}: ${(e as Error).message}`,
      });
    }
  }

  if (!persistenceAvailable) return null;

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Recover unlinked recordings
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            WAV files on disk that aren&apos;t attached to any saved ticket. These
            usually appear when a recording was made but the ticket was never saved.
          </p>
        </div>
        <div className="flex gap-2">
          {open && (
            <button
              type="button"
              className="btn-ghost"
              onClick={refresh}
              disabled={loading}
              title="Re-scan the audio directory"
            >
              {loading ? "Scanning…" : "Refresh"}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {open && error && <WarningBox tone="danger">{error}</WarningBox>}

      {open && !error && !loading && orphans.length === 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          No orphaned recordings — every WAV on disk is linked to a saved ticket.
        </p>
      )}

      {open && orphans.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {orphans.map((f) => {
            const sizeMb = (f.sizeBytes / (1024 * 1024)).toFixed(1);
            const when = f.modifiedMs
              ? formatDateTime(new Date(f.modifiedMs).toISOString())
              : "(unknown time)";
            const isPlaying = playingPath === f.path;
            return (
              <li
                key={f.path}
                className="flex flex-col gap-2 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div
                    className="truncate font-mono text-xs text-slate-700 dark:text-slate-200"
                    title={f.path}
                  >
                    {f.filename}
                  </div>
                  <div className="text-xs text-slate-500">
                    {when} · {sizeMb} MB
                  </div>
                  {isPlaying && playingUrl && (
                    <audio
                      className="mt-2 w-full"
                      src={playingUrl}
                      controls
                      autoPlay
                    />
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => play(f)}
                    title="Play this recording"
                  >
                    {isPlaying ? "Reload" : "Play"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => reveal(f)}
                    title="Show in Finder"
                  >
                    Reveal
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => restore(f)}
                    title="Load into the editor so you can transcribe and save it"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-red-600 dark:text-red-400"
                    onClick={() => remove(f)}
                    title="Permanently delete this file"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
