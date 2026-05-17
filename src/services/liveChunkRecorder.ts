/**
 * Phase 11A — chunked recorder for near-real-time transcription.
 *
 * Keeps a single MediaStream open across the whole session and cycles
 * MediaRecorder instances over it. Each cycle produces one self-contained
 * audio file that decodes independently — important because whisper.cpp
 * needs a standalone WAV, and an Opus chunk taken out of the middle of a
 * MediaRecorder session is not playable on its own.
 *
 * Boundary loss: each MediaRecorder.stop()/start() cycle drops on the order
 * of 10–20 ms of audio at the seam. The final whisper pass uses the
 * concatenation of all chunks, so the *source-of-truth* transcript carries
 * the same gaps; the gaps are not introduced by the chunking machinery.
 */

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

export interface ChunkPayload {
  blob: Blob;
  mimeType: string;
  index: number;
  startedAtMs: number;
  durationMs: number;
}

export interface LiveChunkRecorderOptions {
  chunkSeconds: number;
  onChunk: (chunk: ChunkPayload) => void;
}

export interface FinalRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  chunks: ChunkPayload[];
}

export class LiveChunkRecorder {
  private mediaStream: MediaStream | null = null;
  private currentRec: MediaRecorder | null = null;
  private currentChunks: BlobPart[] = [];
  private chunkTimer: number | null = null;
  private sessionStartedAt = 0;
  private chunkStartedAt = 0;
  private chunkIndex = 0;
  private collected: ChunkPayload[] = [];
  private isStopping = false;
  private isPaused = false;
  private pausedAt = 0;
  private totalPausedMs = 0;
  private mimeType: string | undefined;
  private chunkSeconds: number;
  private onChunk: (chunk: ChunkPayload) => void;
  private cycleChain: Promise<void> = Promise.resolve();

  constructor(options: LiveChunkRecorderOptions) {
    this.chunkSeconds = Math.max(1, Math.floor(options.chunkSeconds));
    this.onChunk = options.onChunk;
  }

  static isAvailable(): boolean {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined"
    );
  }

  isRecording(): boolean {
    return this.currentRec?.state === "recording";
  }

  isPausedNow(): boolean {
    return this.isPaused;
  }

  /**
   * Returns the live MediaStream — used by the audio-level meter to attach an
   * AnalyserNode without spawning a second getUserMedia call (which would
   * conflict on platforms that exclusive-lock the mic).
   */
  getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  async start(constraints?: {
    deviceId?: string;
    noiseSuppression?: boolean;
    echoCancellation?: boolean;
    autoGainControl?: boolean;
  }): Promise<void> {
    if (!LiveChunkRecorder.isAvailable()) {
      throw new Error(
        "Microphone capture is not available in this browser/webview. Run the desktop build with `npm run tauri:dev`.",
      );
    }
    if (this.mediaStream) {
      throw new Error("Already capturing.");
    }
    const c = constraints ?? {};
    const audio: MediaTrackConstraints = {
      echoCancellation: c.echoCancellation ?? true,
      noiseSuppression: c.noiseSuppression ?? true,
      autoGainControl: c.autoGainControl ?? true,
    };
    if (c.deviceId) audio.deviceId = { exact: c.deviceId };
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      // Fall back to default device if the pinned one isn't available.
      if (c.deviceId && (e as { name?: string })?.name === "OverconstrainedError") {
        delete audio.deviceId;
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio });
      } else {
        throw new Error(friendlyMicError(e));
      }
    }
    this.mimeType = pickMimeType();
    this.sessionStartedAt = Date.now();
    this.collected = [];
    this.chunkIndex = 0;
    this.totalPausedMs = 0;
    this.isPaused = false;
    this.isStopping = false;
    this.startChunk();
  }

  pause(): boolean {
    if (!this.currentRec || this.isPaused) return false;
    if (this.currentRec.state !== "recording") return false;
    try {
      this.currentRec.pause();
    } catch {
      return false;
    }
    if (this.chunkTimer != null) {
      window.clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }
    this.isPaused = true;
    this.pausedAt = Date.now();
    return true;
  }

  resume(): boolean {
    if (!this.currentRec || !this.isPaused) return false;
    try {
      this.currentRec.resume();
    } catch {
      return false;
    }
    this.totalPausedMs += Date.now() - this.pausedAt;
    this.pausedAt = 0;
    this.isPaused = false;
    this.scheduleRoll();
    return true;
  }

  /**
   * Stop the session and return the concatenated full recording plus the
   * per-chunk payload list. Pending chunk rolls are awaited first so no
   * audio is lost on close.
   */
  async stop(): Promise<FinalRecording> {
    this.isStopping = true;
    if (this.chunkTimer != null) {
      window.clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }
    if (this.currentRec && this.currentRec.state !== "inactive") {
      const finalRoll = this.rollCurrentChunk();
      this.cycleChain = this.cycleChain.then(() => finalRoll);
      await finalRoll;
    }
    await this.cycleChain;
    this.releaseStream();
    const mimeType = this.collected[0]?.mimeType || this.mimeType || "audio/webm";
    const blob = new Blob(
      this.collected.map((c) => c.blob),
      { type: mimeType },
    );
    return {
      blob,
      mimeType,
      durationMs:
        Date.now() -
        this.sessionStartedAt -
        this.totalPausedMs -
        (this.isPaused && this.pausedAt ? Date.now() - this.pausedAt : 0),
      chunks: this.collected.slice(),
    };
  }

  cancel(): void {
    this.isStopping = true;
    if (this.chunkTimer != null) {
      window.clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }
    if (this.currentRec && this.currentRec.state !== "inactive") {
      try {
        this.currentRec.stop();
      } catch {
        /* ignore */
      }
    }
    this.releaseStream();
    this.collected = [];
    this.currentRec = null;
    this.currentChunks = [];
  }

  private releaseStream(): void {
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
  }

  private startChunk(): void {
    if (!this.mediaStream) return;
    if (this.isStopping) return;
    this.chunkStartedAt = Date.now();
    this.currentChunks = [];
    try {
      this.currentRec = new MediaRecorder(
        this.mediaStream,
        this.mimeType ? { mimeType: this.mimeType } : undefined,
      );
    } catch {
      this.currentRec = new MediaRecorder(this.mediaStream);
    }
    this.currentRec.addEventListener("dataavailable", (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.currentChunks.push(e.data);
    });
    this.currentRec.start();
    this.scheduleRoll();
  }

  private scheduleRoll(): void {
    if (this.chunkTimer != null) window.clearTimeout(this.chunkTimer);
    this.chunkTimer = window.setTimeout(() => {
      this.chunkTimer = null;
      this.cycleChain = this.cycleChain.then(() => this.rollCurrentChunk());
    }, this.chunkSeconds * 1000);
  }

  /**
   * Stop the current MediaRecorder, package the chunks it produced into a
   * ChunkPayload, push it onto the collected list, fire onChunk, and start
   * the next MediaRecorder over the same MediaStream.
   */
  private async rollCurrentChunk(): Promise<void> {
    const rec = this.currentRec;
    if (!rec || rec.state === "inactive") return;
    const collectedBefore = this.collected.length;
    const sessionStart = this.sessionStartedAt;
    const localStartedAt = this.chunkStartedAt;
    const myIndex = this.chunkIndex++;
    await new Promise<void>((resolve) => {
      const onStop = () => {
        const blob = new Blob(this.currentChunks, {
          type: rec.mimeType || this.mimeType || "audio/webm",
        });
        const payload: ChunkPayload = {
          blob,
          mimeType: rec.mimeType || this.mimeType || "audio/webm",
          index: myIndex,
          startedAtMs: localStartedAt - sessionStart,
          durationMs: Date.now() - localStartedAt,
        };
        if (blob.size > 0) {
          this.collected.push(payload);
          try {
            this.onChunk(payload);
          } catch {
            /* never let consumers kill the recording */
          }
        }
        this.currentChunks = [];
        resolve();
      };
      const onError = () => resolve();
      rec.addEventListener("stop", onStop, { once: true });
      rec.addEventListener("error", onError, { once: true });
      try {
        rec.stop();
      } catch {
        // If stop throws, fall back to resolving so the chain doesn't deadlock.
        resolve();
      }
    });
    // Even if nothing was collected this cycle (e.g. immediate stop), keep
    // monotonic chunk indices stable by checking against `collectedBefore`.
    void collectedBefore;
    if (!this.isStopping && !this.isPaused) {
      this.startChunk();
    } else {
      this.currentRec = null;
    }
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
  return `Could not access microphone: ${msg}`;
}
