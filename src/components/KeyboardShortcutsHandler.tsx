import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { copyText } from "../services/clipboardService";
import { useConfirm } from "./ConfirmDialog";
import {
  bareKeyMatcher,
  modKeyMatcher,
  useKeyboardShortcuts,
  type KeyboardShortcut,
} from "../hooks/useKeyboardShortcuts";
import { buildFullTicketText } from "../services/ticketFieldGenerator";

export function KeyboardShortcutsHandler() {
  const navigate = useNavigate();
  const audio = useAppStore((s) => s.audio);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  const cancelRecording = useAppStore((s) => s.cancelRecording);
  const analyze = useAppStore((s) => s.analyzeCurrentTranscript);
  const ticketFields = useAppStore((s) => s.ticketFields);
  const save = useAppStore((s) => s.saveCurrentTicket);
  const reset = useAppStore((s) => s.resetWorkflow);
  const setStatus = useAppStore((s) => s.setStatus);
  // Phase 9: when Copy Mode is active, the panel registers its own
  // Cmd/Ctrl+Shift+C / Cmd/Ctrl+S handlers. The window-level keydown listener
  // dispatches in registration order, so the panel's handlers run first; the
  // global ones below check this flag and no-op when copy mode owns them.
  const copyModeActive = useAppStore((s) => s.copyModeActive);
  const askConfirm = useConfirm();

  const shortcuts: KeyboardShortcut[] = useMemo(
    () => [
      {
        id: "record",
        label: "Start/Stop Recording",
        combo: "Cmd/Ctrl+R",
        match: modKeyMatcher("r"),
        handler: async () => {
          if (audio.status === "recording" || audio.status === "paused") {
            await stopRecording();
            setStatus({ kind: "info", message: "Recording stopped (shortcut)." });
          } else if (audio.status === "idle" || audio.status === "ready") {
            await startRecording();
          }
        },
      },
      {
        id: "analyze",
        label: "Analyze Transcript",
        combo: "Cmd/Ctrl+Enter",
        match: modKeyMatcher("enter"),
        handler: async () => {
          await analyze();
          navigate("/form");
        },
      },
      {
        id: "copy-full",
        label: "Copy Full Ticket",
        combo: "Cmd/Ctrl+Shift+C",
        match: modKeyMatcher("shift+c"),
        handler: async () => {
          // Yield to Copy Mode's per-field shortcut when it owns the screen.
          if (copyModeActive) return;
          if (!ticketFields.subject && !ticketFields.description) {
            setStatus({ kind: "warning", message: "No ticket to copy yet." });
            return;
          }
          try {
            await copyText(buildFullTicketText(ticketFields));
            setStatus({ kind: "success", message: "Copied full ticket (shortcut)." });
          } catch (e) {
            setStatus({ kind: "error", message: `Copy failed: ${(e as Error).message}` });
          }
        },
      },
      {
        id: "save",
        label: "Save Ticket",
        combo: "Cmd/Ctrl+S",
        match: modKeyMatcher("s"),
        handler: () => {
          // Copy Mode rebinds Cmd/Ctrl+S to Skip while active.
          if (copyModeActive) return;
          save();
        },
      },
      {
        id: "new",
        label: "New Ticket",
        combo: "Cmd/Ctrl+N",
        match: modKeyMatcher("n"),
        handler: async () => {
          const ok = await askConfirm({
            title: "Start a new ticket?",
            message:
              "Any unsaved progress on the current capture (transcript, extracted fields, generated note) will be cleared.",
            confirmLabel: "Start new",
          });
          if (!ok) return;
          reset();
          navigate("/voice");
        },
      },
      {
        id: "back",
        label: "Back to Previous Step",
        combo: "Cmd/Ctrl+B",
        match: modKeyMatcher("b"),
        handler: () => {
          navigate(-1);
        },
      },
      {
        id: "escape",
        label: "Cancel recording or blur input",
        combo: "Esc",
        match: bareKeyMatcher("Escape"),
        preventDefault: false,
        handler: () => {
          if (audio.status === "recording" || audio.status === "paused") {
            cancelRecording();
            return;
          }
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        },
      },
    ],
    [
      audio.status,
      startRecording,
      stopRecording,
      cancelRecording,
      analyze,
      ticketFields,
      save,
      reset,
      navigate,
      setStatus,
      copyModeActive,
      askConfirm,
    ],
  );

  useKeyboardShortcuts(shortcuts);
  return null;
}
