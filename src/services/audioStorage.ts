import { invoke } from "@tauri-apps/api/core";

function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isPersistenceAvailable(): boolean {
  return isTauriContext();
}

export async function saveAudioFile(filename: string, bytes: Uint8Array): Promise<string> {
  if (!isTauriContext()) {
    throw new Error(
      "Saving audio to disk requires the Tauri desktop app. Browser preview keeps audio in memory only.",
    );
  }
  return await invoke<string>("save_audio_file", {
    filename,
    bytes: Array.from(bytes),
  });
}

export async function deleteAudioFile(path: string | null): Promise<void> {
  if (!path || !isTauriContext()) return;
  await invoke<void>("delete_audio_file", { path });
}

/**
 * Phase 11D — copy a user-chosen audio file into the app's audio directory
 * and return the new path. The original file is untouched.
 */
export async function importAudioFile(sourcePath: string): Promise<string> {
  if (!isTauriContext()) {
    throw new Error("Attaching an existing recording requires the Tauri desktop app.");
  }
  return await invoke<string>("import_audio_file", { sourcePath });
}

export async function readAudioFile(path: string): Promise<Uint8Array> {
  if (!isTauriContext()) {
    throw new Error("Reading audio from disk requires the Tauri desktop app.");
  }
  const arr = await invoke<number[]>("read_audio_file", { path });
  return new Uint8Array(arr);
}

export async function audioDataDir(): Promise<string | null> {
  if (!isTauriContext()) return null;
  try {
    return await invoke<string>("audio_data_dir");
  } catch {
    return null;
  }
}

/**
 * Reveal the audio file in the OS file manager (Finder/Explorer/xdg-open).
 * Returns false when the platform doesn't support reveal so the UI can
 * disable the button with a clear reason.
 */
export async function revealAudioFile(path: string): Promise<void> {
  if (!isTauriContext()) {
    throw new Error("Revealing audio in the file manager requires the Tauri desktop app.");
  }
  await invoke<void>("reveal_audio_file", { path });
}

/**
 * Build a playable object URL for an audio file on disk by streaming the
 * bytes through the existing `read_audio_file` command. We deliberately do
 * NOT use Tauri's asset protocol because it isn't enabled in the current
 * `tauri.conf.json` security settings.
 */
export async function audioFileToObjectUrl(path: string, format: string): Promise<string> {
  const bytes = await readAudioFile(path);
  const mime = format === "wav" ? "audio/wav" : `audio/${format}`;
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
}

/**
 * One on-disk audio file as reported by the Rust `list_audio_files` command.
 * Mirrors the AudioFileEntry struct in src-tauri/src/commands/audio.rs.
 */
export interface OnDiskAudioFile {
  path: string;
  filename: string;
  sizeBytes: number;
  modifiedMs: number;
}

/**
 * List every WAV file currently in the app's audio directory. Returns an
 * empty list in browser preview (no Tauri context).
 *
 * Used by `findOrphanedAudio()` to recover recordings that were written to
 * disk but never linked to a ticket — see HistoryPage's recovery panel.
 */
export async function listAudioFilesOnDisk(): Promise<OnDiskAudioFile[]> {
  if (!isTauriContext()) return [];
  const rows = await invoke<
    {
      path: string;
      filename: string;
      size_bytes: number;
      modified_ms: number;
    }[]
  >("list_audio_files");
  return rows.map((r) => ({
    path: r.path,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    modifiedMs: r.modified_ms,
  }));
}
