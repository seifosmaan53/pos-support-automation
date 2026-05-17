/**
 * Phase 12 — TypeScript wrappers for the `commands::system` Rust commands.
 *
 * Kept in a separate module from audioStorage so the responsibilities stay
 * clear: this module handles folders + arbitrary text files (backup JSON,
 * settings JSON, error log dumps), audioStorage handles the audio files
 * themselves.
 *
 * All functions throw outside the Tauri desktop app — the UI is expected
 * to check `isTauriDesktop()` first and disable the relevant button with
 * a clear message in browser preview.
 */
import { invoke } from "@tauri-apps/api/core";

export interface AppPaths {
  appData: string;
  audio: string;
  backup: string;
  models: string;
  tools: string;
  appLog: string;
  audioExists: boolean;
  backupExists: boolean;
  modelsExists: boolean;
  toolsExists: boolean;
}

interface AppPathsRaw {
  app_data: string;
  audio: string;
  backup: string;
  models: string;
  tools: string;
  app_log: string;
  audio_exists: boolean;
  backup_exists: boolean;
  models_exists: boolean;
  tools_exists: boolean;
}

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAppPaths(): Promise<AppPaths> {
  if (!isTauriDesktop()) {
    throw new Error("App paths are only available in the Tauri desktop app.");
  }
  const raw = await invoke<AppPathsRaw>("app_paths");
  return {
    appData: raw.app_data,
    audio: raw.audio,
    backup: raw.backup,
    models: raw.models,
    tools: raw.tools,
    appLog: raw.app_log,
    audioExists: raw.audio_exists,
    backupExists: raw.backup_exists,
    modelsExists: raw.models_exists,
    toolsExists: raw.tools_exists,
  };
}

export async function openInFolder(path: string): Promise<void> {
  if (!isTauriDesktop()) {
    throw new Error("Opening folders requires the Tauri desktop app.");
  }
  await invoke<void>("open_in_folder", { path });
}

export async function checkPathsExist(paths: string[]): Promise<boolean[]> {
  if (!isTauriDesktop()) return paths.map(() => false);
  return await invoke<boolean[]>("check_paths_exist", { paths });
}

export async function writeTextFile(
  path: string,
  contents: string,
  overwrite = false,
): Promise<void> {
  if (!isTauriDesktop()) {
    throw new Error("Writing files requires the Tauri desktop app.");
  }
  await invoke<void>("write_text_file", { path, contents, overwrite });
}

export async function readTextFile(path: string): Promise<string> {
  if (!isTauriDesktop()) {
    throw new Error("Reading files requires the Tauri desktop app.");
  }
  return await invoke<string>("read_text_file", { path });
}

export async function copyAudioFiles(
  sourcePaths: string[],
  destDir: string,
): Promise<number> {
  if (!isTauriDesktop()) {
    throw new Error("Copying audio files requires the Tauri desktop app.");
  }
  return await invoke<number>("copy_audio_files", {
    sourcePaths,
    destDir,
  });
}
