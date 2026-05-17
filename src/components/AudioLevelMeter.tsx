import { useEffect, useRef } from "react";
import { getActiveMediaStream } from "../services/appStore";

/**
 * Phase 11A — audio level meter for the recording header.
 *
 * Attaches an AnalyserNode to the active recorder's MediaStream and renders
 * a horizontal bar that animates with the input volume. The render path is
 * deliberately ref-based (no setState per frame) so the parent component
 * never re-renders while the meter ticks.
 *
 * Low-volume warning: when the smoothed RMS stays below the threshold for
 * ~1.5 s, the bar turns amber and shows a "Low / Silent" label. This catches
 * the "muted mic" / "wrong device" case without nagging on legitimate pauses.
 */
export function AudioLevelMeter({
  pollMs = 500,
  className,
}: {
  /** How often to retry attaching when no stream exists yet. */
  pollMs?: number;
  className?: string;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let pollTimer: number | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let stopped = false;

    let lowSinceMs: number | null = null;
    let clippingSinceMs: number | null = null;

    function paint(level: number, peak: number) {
      if (!barRef.current) return;
      const pct = Math.min(100, Math.round(level * 100));
      barRef.current.style.width = `${pct}%`;
      const now = performance.now();

      const low = level < 0.04;
      if (low) {
        if (lowSinceMs === null) lowSinceMs = now;
      } else {
        lowSinceMs = null;
      }
      const sustainedLow = lowSinceMs !== null && now - lowSinceMs > 1500;

      // Clipping: peak sample at or beyond ~0.95 sustained for ~300 ms.
      // One spike doesn't count — sustained gives confidence it's the user
      // talking too close to the mic, not a door slam.
      const clipping = peak > 0.95;
      if (clipping) {
        if (clippingSinceMs === null) clippingSinceMs = now;
      } else {
        clippingSinceMs = null;
      }
      const sustainedClipping =
        clippingSinceMs !== null && now - clippingSinceMs > 300;

      if (barRef.current) {
        barRef.current.style.background = sustainedClipping
          ? "linear-gradient(to right, #ef4444, #b91c1c)"
          : sustainedLow
            ? "linear-gradient(to right, #f59e0b, #f97316)"
            : level > 0.6
              ? "linear-gradient(to right, #10b981, #f97316)"
              : "linear-gradient(to right, #38bdf8, #10b981)";
      }
      if (labelRef.current) {
        labelRef.current.textContent = sustainedClipping
          ? "Clipping — back off"
          : sustainedLow
            ? "Low / silent"
            : level > 0.6
              ? "Strong"
              : level > 0.15
                ? "Good"
                : "Quiet";
      }
    }

    function tick() {
      if (stopped || !analyser) return;
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      // Compute RMS of the centered samples AND track the peak magnitude
      // so we can flag clipping ("sample at the edge of ±1.0 sustained").
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      // Slight perceptual curve — small inputs feel louder this way.
      paint(Math.min(1, rms * 1.6), peak);
      raf = requestAnimationFrame(tick);
    }

    function attach(stream: MediaStream) {
      try {
        const Ctor: typeof AudioContext =
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext ?? window.AudioContext;
        audioCtx = new Ctor();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        raf = requestAnimationFrame(tick);
      } catch {
        // AudioContext unavailable (test env, locked-down WKWebView, etc.) —
        // just leave the bar at zero. No error surface needed; the user can
        // still record.
      }
    }

    function tryAttach() {
      const s = getActiveMediaStream();
      if (s) {
        attach(s);
        return;
      }
      pollTimer = window.setTimeout(tryAttach, pollMs) as unknown as number;
    }

    tryAttach();

    return () => {
      stopped = true;
      if (pollTimer != null) window.clearTimeout(pollTimer);
      if (raf) cancelAnimationFrame(raf);
      try {
        source?.disconnect();
        analyser?.disconnect();
        void audioCtx?.close();
      } catch {
        /* ignore */
      }
    };
  }, [pollMs]);

  return (
    <div
      className={`flex items-center gap-2 ${className ?? ""}`}
      title="Microphone input level. Stays low if the wrong device is selected or the mic is muted."
    >
      <div className="relative h-2 w-32 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          ref={barRef}
          className="absolute inset-y-0 left-0 transition-[width] duration-75 ease-out"
          style={{ width: "0%", background: "#38bdf8" }}
        />
      </div>
      <span
        ref={labelRef}
        className="text-[10px] font-medium text-slate-500 dark:text-slate-400"
      >
        Idle
      </span>
    </div>
  );
}

/**
 * React hook: lists available audio input devices and re-enumerates on device
 * change. Returns a stable array even when permission hasn't been granted
 * (in that case device labels read as empty strings — only IDs are visible).
 */
import { useState } from "react";

export interface MicOption {
  deviceId: string;
  label: string;
}

export function useAudioInputDevices(): MicOption[] {
  const [devices, setDevices] = useState<MicOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices(
          list
            .filter((d) => d.kind === "audioinput")
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Microphone (${d.deviceId.slice(0, 6)}…)`,
            })),
        );
      } catch {
        /* ignore */
      }
    }
    refresh();
    const handler = () => refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    };
  }, []);
  return devices;
}
