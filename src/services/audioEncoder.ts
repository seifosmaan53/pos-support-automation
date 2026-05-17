export interface EncodedWav {
  bytes: Uint8Array<ArrayBuffer>;
  sampleRate: number;
  durationMs: number;
  /** Phase 16B — peak abs sample value in [0,1]. Used by the live chunk classifier. */
  peakLevel: number;
  /** Phase 16B — RMS sample value in [0,1]. Used by the live chunk classifier. */
  rmsLevel: number;
}

const TARGET_SAMPLE_RATE = 16000;

export async function blobToWav16kMono(blob: Blob): Promise<EncodedWav> {
  if (blob.size === 0) {
    throw new Error("Recording is empty (no audio captured).");
  }

  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await decode(arrayBuffer);

  const length = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  if (length <= 0) {
    throw new Error("Recording duration is zero.");
  }

  const offline = new OfflineAudioContext({
    numberOfChannels: 1,
    length,
    sampleRate: TARGET_SAMPLE_RATE,
  });
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();

  const samples = rendered.getChannelData(0);
  const bytes = encodePcm16Wav(samples, TARGET_SAMPLE_RATE);

  // Phase 16B — measure peak + rms in a single pass so the live chunk
  // classifier can distinguish "real speech" from "silence + whisper
  // hallucination" without re-decoding the WAV. Cheap (~O(n) over the
  // same buffer encodePcm16Wav already walks).
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const abs = v < 0 ? -v : v;
    if (abs > peak) peak = abs;
    sumSq += v * v;
  }
  const rmsLevel = samples.length > 0 ? Math.sqrt(sumSq / samples.length) : 0;

  return {
    bytes,
    sampleRate: TARGET_SAMPLE_RATE,
    durationMs: Math.round(decoded.duration * 1000),
    peakLevel: peak,
    rmsLevel,
  };
}

async function decode(buffer: ArrayBuffer): Promise<AudioBuffer> {
  const Ctx =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    throw new Error("Web Audio API is not available in this webview.");
  }
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(buffer.slice(0));
  } catch (e) {
    throw new Error(
      `Could not decode the recording (${(e as Error).message}). The mic capture format may be unsupported.`,
    );
  } finally {
    if (typeof ctx.close === "function") {
      ctx.close().catch(() => undefined);
    }
  }
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const numChannels = 1;
  const bytesPerSample = 2;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
