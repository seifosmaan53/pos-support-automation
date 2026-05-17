/**
 * Phase 16D — runtime microphone watcher.
 *
 * Subscribes to `navigator.mediaDevices.devicechange` and emits two
 * shapes of startup-warning banner via the existing dismissable banner
 * infrastructure:
 *
 *   1. NEW DEVICE — when a non-default audioinput appears (typically
 *      an external mic plugged in). Banner id: `mic-detected:<deviceId>`.
 *      Action link sends the user to /settings.
 *
 *   2. SELECTED DEVICE DISAPPEARED — when the user's pinned
 *      audioInputDeviceId no longer enumerates. Banner id:
 *      `mic-unavailable:<deviceId>`. Recorder already falls back to the
 *      default device at startRecording time; this banner is purely the
 *      visible heads-up the spec requires.
 *
 * Idempotent and safe to call multiple times. Returns an unsubscribe
 * function so callers can clean up on app teardown.
 */
import { listInputDevices, subscribeDeviceChanges } from "./microphoneDevices";
import type { StartupWarning } from "./startupSafety";

interface WatcherDeps {
  pushWarning: (w: StartupWarning) => void;
  getActiveDeviceId: () => string;
}

/**
 * Start the microphone watcher. Caller pumps in a `getActiveDeviceId`
 * accessor + a `pushWarning` callback so this module stays pure-Tauri-
 * free and easy to test.
 */
export function startMicrophoneWatcher(deps: WatcherDeps): () => void {
  let lastDeviceIds = new Set<string>();
  let primed = false;

  const sync = async () => {
    let devices: { deviceId: string; label: string; kind: string }[];
    try {
      devices = await listInputDevices();
    } catch {
      return;
    }
    const currentIds = new Set(devices.map((d) => d.deviceId));

    // First call → just snapshot. No banner — we don't want to nag the
    // user about every mic the OS already had when the app started.
    if (!primed) {
      lastDeviceIds = currentIds;
      primed = true;
      return;
    }

    // New devices that weren't here before. Default ("default" deviceId
    // and "communications") never raises a banner — those represent the
    // OS-level routing entry, not a physical device.
    for (const d of devices) {
      if (lastDeviceIds.has(d.deviceId)) continue;
      if (d.deviceId === "default" || d.deviceId === "communications") continue;
      deps.pushWarning({
        id: `mic-detected:${d.deviceId}`,
        severity: "info",
        message: `New microphone detected: ${d.label || "(unnamed device)"}.`,
        link: { to: "/settings", label: "Open Audio Settings" },
      });
    }

    // The selected device just vanished. We don't auto-switch here — the
    // recorder falls back to the default at the next getUserMedia call —
    // we just surface a clear warning so the user knows.
    const selected = deps.getActiveDeviceId();
    if (
      selected &&
      lastDeviceIds.has(selected) &&
      !currentIds.has(selected)
    ) {
      deps.pushWarning({
        id: `mic-unavailable:${selected}`,
        severity: "warning",
        message:
          "Selected microphone is unavailable. Recording will fall back to the default input.",
        link: { to: "/settings", label: "Open Audio Settings" },
      });
    }

    lastDeviceIds = currentIds;
  };

  const unsub = subscribeDeviceChanges(() => {
    void sync();
  });

  // Prime the cache once on startup so the first real devicechange
  // event has a baseline to diff against.
  void sync();

  return unsub;
}
