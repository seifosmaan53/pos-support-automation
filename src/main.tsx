import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./index.css";
import { initStorage } from "./services/databaseService";
import { useAppStore } from "./services/appStore";
import { computeStartupWarnings } from "./services/startupSafety";
import { startMicrophoneWatcher } from "./services/microphoneWatcher";

// Hydrate the in-memory ticket cache (from SQLite when running inside Tauri,
// from localStorage otherwise) before the first paint so HistoryPage and
// the rest of the app see a populated store on mount. We render even if init
// rejects — the worst case is an empty list, which is recoverable.
initStorage().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );

  // Phase 12 — compute non-blocking startup warnings AFTER first paint so a
  // slow AI ping never delays the UI. The warnings appear via the banner
  // once they resolve. Failures here are themselves logged.
  void computeStartupWarnings().then((warnings) => {
    useAppStore.getState().setStartupWarnings(warnings);
  });

  // Phase 16D — runtime microphone watcher. Pipes "new mic plugged in"
  // and "selected mic disappeared" events into the same banner system as
  // boot warnings, so the user sees them on the Home page next time they
  // open it. Single subscription for the app's lifetime — never returned.
  startMicrophoneWatcher({
    pushWarning: (w) => useAppStore.getState().appendStartupWarning(w),
    getActiveDeviceId: () =>
      useAppStore.getState().settings.audioInputDeviceId,
  });
});
