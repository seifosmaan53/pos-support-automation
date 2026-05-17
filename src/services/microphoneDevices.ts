/**
 * Phase 16D — microphone device enumeration + classification.
 *
 * Wraps `navigator.mediaDevices.enumerateDevices()` + the `devicechange`
 * event so the rest of the app can:
 *   • list every audio-input device with a stable id and a human label
 *   • react when a new mic is plugged in or the active one disappears
 *   • classify a device as built-in / external / unknown by its label
 *
 * `classifyDeviceLabel` is pure and easy to test — the label heuristics
 * are necessarily English-centric, but they cover the common macOS /
 * Windows / Linux naming conventions for built-in vs USB/Bluetooth mics.
 */

export type DeviceKind = "builtin" | "external" | "unknown";

export interface AudioInputDevice {
  deviceId: string;
  groupId: string;
  label: string;
  kind: DeviceKind;
  isDefault: boolean;
}

const BUILTIN_HINTS = [
  "macbook",
  "built-in",
  "built in",
  "internal microphone",
  "internal mic",
  "internal",
  "default - macbook",
  "realtek",
  "intel",
  "amd",
  "high definition audio",
];

const EXTERNAL_HINTS = [
  "usb",
  "bluetooth",
  "airpods",
  "headset",
  "headphones",
  "yeti",
  "blue ",
  "rode",
  "shure",
  "logitech",
  "jabra",
  "samson",
  "elgato",
  "snowball",
  "podcast",
  "stream",
  "external",
];

/**
 * Classify a microphone by its OS-supplied label. Falls back to "unknown"
 * when permission hasn't been granted (label is empty in that case).
 *
 * Built-in hints win first — labels like "Default - MacBook Pro Microphone
 * (Built-in)" must classify as builtin even though they also contain
 * markers (parentheses, "microphone") that look generic. External-only
 * hints (USB / Bluetooth / vendor names) override builtin if they're also
 * present, since a "USB Built-in Sound Adapter" is genuinely external.
 */
export function classifyDeviceLabel(label: string): DeviceKind {
  if (!label || !label.trim()) return "unknown";
  const lower = label.toLowerCase();
  const hasExternal = EXTERNAL_HINTS.some((h) => lower.includes(h));
  const hasBuiltin = BUILTIN_HINTS.some((h) => lower.includes(h));
  if (hasExternal) return "external";
  if (hasBuiltin) return "builtin";
  return "unknown";
}

export function isMediaDevicesAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.enumerateDevices === "function"
  );
}

/**
 * Returns every available audio-input device. `isDefault` is true for the
 * entry whose deviceId === "default" if the platform exposes it (Chrome
 * + Edge do; Safari and Firefox do not).
 */
export async function listInputDevices(): Promise<AudioInputDevice[]> {
  if (!isMediaDevicesAvailable()) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({
      deviceId: d.deviceId,
      groupId: d.groupId,
      label: d.label,
      kind: classifyDeviceLabel(d.label),
      isDefault: d.deviceId === "default",
    }));
}

/**
 * Subscribe to mic plug/unplug events. Returns an unsubscribe function.
 * Fires every time the browser/OS detects a device change, regardless of
 * whether the change affects an audio input — the callback is responsible
 * for diffing against its previous state.
 */
export function subscribeDeviceChanges(cb: () => void): () => void {
  if (!isMediaDevicesAvailable()) return () => undefined;
  const handler = () => cb();
  navigator.mediaDevices.addEventListener("devicechange", handler);
  return () => {
    navigator.mediaDevices.removeEventListener("devicechange", handler);
  };
}

/**
 * Take a short audio sample from the named device and return peak + rms
 * levels. Used by the Test Microphone button. Stops the stream on the
 * way out so the OS recording indicator doesn't linger.
 */
export interface MicProbeResult {
  durationMs: number;
  peakLevel: number;
  rmsLevel: number;
  speechDetected: boolean;
  /** Optional verdict string for the UI ("Good" / "Low" / etc.). */
  verdict: "good" | "low" | "loud" | "silent" | "noisy";
}

export async function quickProbe(
  deviceId?: string,
  durationMs = 3000,
): Promise<MicProbeResult> {
  if (!isMediaDevicesAvailable()) {
    throw new Error("Microphone API is not available in this environment.");
  }
  const constraints: MediaStreamConstraints = {
    audio: deviceId
      ? { deviceId: { exact: deviceId } }
      : true,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  try {
    return await sample(stream, durationMs);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

async function sample(stream: MediaStream, durationMs: number): Promise<MicProbeResult> {
  const Ctx =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    throw new Error("Web Audio API is not available.");
  }
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const samples = new Uint8Array(analyser.frequencyBinCount);
  const start = Date.now();
  let peak = 0;
  let sumSq = 0;
  let count = 0;
  let speechHits = 0;
  // ~50ms polling so a 3-second probe takes 60 samples — plenty for stats.
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      // samples are 0..255 centered at 128; convert to signed -1..+1.
      let framePeak = 0;
      let frameSum = 0;
      for (let i = 0; i < samples.length; i++) {
        const v = (samples[i] - 128) / 128;
        const abs = v < 0 ? -v : v;
        if (abs > framePeak) framePeak = abs;
        frameSum += v * v;
      }
      const frameRms = Math.sqrt(frameSum / samples.length);
      if (framePeak > peak) peak = framePeak;
      sumSq += frameRms * frameRms;
      count += 1;
      if (frameRms > 0.025) speechHits += 1;
      if (Date.now() - start >= durationMs) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
  ctx.close().catch(() => undefined);
  const rmsAvg = count > 0 ? Math.sqrt(sumSq / count) : 0;
  const speechDetected = speechHits >= 3;
  let verdict: MicProbeResult["verdict"] = "good";
  if (peak >= 0.95) verdict = "loud";
  else if (rmsAvg < 0.005) verdict = "silent";
  else if (rmsAvg < 0.02) verdict = "low";
  else if (speechHits === 0 && peak > 0.1) verdict = "noisy";
  else verdict = "good";
  return {
    durationMs: Date.now() - start,
    peakLevel: Math.min(1, peak),
    rmsLevel: Math.min(1, rmsAvg),
    speechDetected,
    verdict,
  };
}
