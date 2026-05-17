export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface AudioConstraintsOverride {
  deviceId?: string;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
}

function buildAudioConstraints(
  override: AudioConstraintsOverride | undefined,
): MediaTrackConstraints {
  const o = override ?? {};
  const c: MediaTrackConstraints = {
    echoCancellation: o.echoCancellation ?? true,
    noiseSuppression: o.noiseSuppression ?? true,
    autoGainControl: o.autoGainControl ?? true,
  };
  if (o.deviceId) c.deviceId = { exact: o.deviceId };
  return c;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const c of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return undefined;
}

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startTime = 0;

  static isAvailable(): boolean {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined"
    );
  }

  isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  isPaused(): boolean {
    return this.recorder?.state === "paused";
  }

  pause(): boolean {
    if (!this.recorder || this.recorder.state !== "recording") return false;
    if (typeof this.recorder.pause !== "function") return false;
    try {
      this.recorder.pause();
      return true;
    } catch {
      return false;
    }
  }

  resume(): boolean {
    if (!this.recorder || this.recorder.state !== "paused") return false;
    if (typeof this.recorder.resume !== "function") return false;
    try {
      this.recorder.resume();
      return true;
    } catch {
      return false;
    }
  }

  async start(constraints?: AudioConstraintsOverride): Promise<void> {
    if (!AudioRecorder.isAvailable()) {
      throw new Error(
        "Microphone capture is not available in this browser/webview. Run the desktop build with `npm run tauri:dev`.",
      );
    }
    if (this.recorder && this.recorder.state === "recording") {
      throw new Error("Already recording.");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(constraints),
      });
    } catch (e) {
      // If the user pinned a specific device that's now unplugged, fall back
      // to the default device so the call doesn't fail. The Settings UI will
      // pick up the missing-device state separately and prompt the user.
      if (constraints?.deviceId && (e as { name?: string })?.name === "OverconstrainedError") {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: buildAudioConstraints({ ...constraints, deviceId: undefined }),
        });
      } else {
        throw new Error(friendlyMicError(e));
      }
    }
    this.mediaStream = stream;

    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.addEventListener("dataavailable", (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    });
    this.recorder.start(1000);
    this.startTime = Date.now();
  }

  async stop(): Promise<RecordingResult> {
    if (!this.recorder || this.recorder.state === "inactive") {
      throw new Error("Not recording.");
    }
    const recorder = this.recorder;
    return await new Promise<RecordingResult>((resolve, reject) => {
      const onStop = () => {
        const blob = new Blob(this.chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        this.cleanup();
        resolve({
          blob,
          mimeType: recorder.mimeType || "audio/webm",
          durationMs: Date.now() - this.startTime,
        });
      };
      const onError = (ev: Event) => {
        this.cleanup();
        const message =
          (ev as ErrorEvent).message ?? "MediaRecorder error during recording.";
        reject(new Error(message));
      };
      recorder.addEventListener("stop", onStop, { once: true });
      recorder.addEventListener("error", onError, { once: true });
      try {
        recorder.stop();
      } catch (e) {
        this.cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      this.mediaStream = null;
    }
    this.recorder = null;
    this.chunks = [];
  }
}

function friendlyMicError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  const name = err?.name ?? "";
  const msg = err?.message ?? String(e);
  if (name === "NotAllowedError" || /denied|permission/i.test(msg)) {
    return "Microphone permission was denied. Grant access in your OS Privacy settings (macOS: System Settings → Privacy & Security → Microphone) and try again.";
  }
  if (name === "NotFoundError" || /no.*device|not found/i.test(msg)) {
    return "No microphone was found. Plug one in and try again.";
  }
  if (name === "NotReadableError" || /in use|busy/i.test(msg)) {
    return "Microphone is in use by another app. Close the other app and try again.";
  }
  if (name === "OverconstrainedError") {
    return "Microphone constraints could not be satisfied by the available device.";
  }
  return `Could not access microphone: ${msg}`;
}
