import { invoke } from "@tauri-apps/api/core";

export interface WhisperResult {
  text: string;
  stderrTail: string;
}

export interface WhisperTestResult {
  ok: boolean;
  executableOk: boolean;
  modelOk: boolean;
  modelSizeBytes: number;
  version: string;
  message: string;
}

function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface TranscribeOptions {
  audioPath: string;
  whisperPath: string;
  modelPath: string;
  language: string;
  threads: number;
  /** Optional domain prompt, passed to whisper.cpp via --prompt. */
  prompt?: string;
}

export async function transcribeAudio(opts: TranscribeOptions): Promise<WhisperResult> {
  if (!isTauriContext()) {
    throw new Error(
      "Local transcription requires the Tauri desktop app — `npm run tauri:dev`. Browser preview cannot spawn whisper.cpp.",
    );
  }
  return await invoke<WhisperResult>("transcribe_audio", {
    audioPath: opts.audioPath,
    whisperPath: opts.whisperPath,
    modelPath: opts.modelPath,
    language: opts.language,
    threads: opts.threads,
    prompt: opts.prompt ?? "",
  });
}

export async function testWhisper(opts: {
  whisperPath: string;
  modelPath: string;
}): Promise<WhisperTestResult> {
  if (!isTauriContext()) {
    return {
      ok: false,
      executableOk: false,
      modelOk: false,
      modelSizeBytes: 0,
      version: "",
      message:
        "Browser preview cannot test the local whisper.cpp executable. Run with `npm run tauri:dev`.",
    };
  }
  return await invoke<WhisperTestResult>("test_whisper", {
    whisperPath: opts.whisperPath,
    modelPath: opts.modelPath,
  });
}

export function friendlyWhisperError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/executable.*not found/i.test(msg)) {
    return "whisper.cpp executable not found. Set the path in Settings → Local Transcription, e.g. `/path/to/whisper.cpp/build/bin/whisper-cli`.";
  }
  if (/model.*not found/i.test(msg) || /no.*model/i.test(msg)) {
    return "Whisper model not found. Download a ggml model (e.g. `ggml-medium.en.bin`) and set its path in Settings → Local Transcription.";
  }
  if (/permission denied/i.test(msg)) {
    return "Permission denied running whisper.cpp. Mark the binary executable: `chmod +x /path/to/whisper-cli`.";
  }
  if (/audio file not found/i.test(msg)) {
    return "Audio file not found on disk. Re-record and try again.";
  }
  if (/empty/i.test(msg) && /path/i.test(msg)) {
    return msg;
  }
  return msg;
}
