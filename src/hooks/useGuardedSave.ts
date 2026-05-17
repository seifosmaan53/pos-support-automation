/**
 * Phase 11D — guarded save hook.
 *
 * Wraps `saveCurrentTicket` with a pre-save check: if the user has a local
 * recording that hasn't been attached to a ticket yet, prompt them with three
 * options:
 *
 *   • Save and Attach Recording (default — primary button)
 *   • Save Without Recording   (tertiary — explicit opt-out)
 *   • Cancel
 *
 * "Do not lose audio" is the rule. The auto-attach is already the default in
 * `saveCurrentTicket`, so the primary button just calls it normally. The
 * tertiary route calls it with `{ attachAudio: false }` to honor the user's
 * explicit choice — used rarely, but the spec requires it.
 *
 * When there's no recording, the hook just calls saveCurrentTicket directly
 * with no prompt.
 */

import { useCallback } from "react";
import { useAppStore } from "../services/appStore";
import { useConfirmExtended } from "../components/ConfirmDialog";

export function useGuardedSave(): () => Promise<boolean> {
  const audio = useAppStore((s) => s.audio);
  const currentTicketId = useAppStore((s) => s.currentTicketId);
  const saveCurrentTicket = useAppStore((s) => s.saveCurrentTicket);
  const confirm = useConfirmExtended();

  return useCallback(async () => {
    const hasLocalRecording = audio.isPersisted && !!audio.wavPath;
    // Check the live audio attachment state. If the current ticket is saved
    // AND it already has a linked audio_files row, auto-attach in
    // saveCurrentTicket is a no-op — no prompt needed.
    let needsPrompt = false;
    if (hasLocalRecording) {
      if (!currentTicketId) {
        // First save — auto-attach will fire. The user almost always wants
        // this; no need to prompt. The audio status card already shows what
        // will happen.
        needsPrompt = false;
      } else {
        // Re-save of an existing ticket — only prompt if no audio is linked
        // yet. (If linked, save is a metadata update, nothing to attach.)
        const { ticketStore } = await import("../services/databaseService");
        const t = ticketStore.get(currentTicketId);
        if (!t?.audioId) needsPrompt = true;
      }
    }

    if (!needsPrompt) {
      const saved = saveCurrentTicket();
      return !!saved;
    }

    const result = await confirm({
      title: "Recording not attached",
      message:
        "You have a recording that is not attached to this ticket. Saving will attach it by default — make sure that's what you want.",
      confirmLabel: "Save and Attach Recording",
      tertiaryLabel: "Save Without Recording",
      cancelLabel: "Cancel",
    });
    if (result === "cancel") return false;
    const saved = saveCurrentTicket({
      attachAudio: result === "confirm",
    });
    return !!saved;
  }, [audio, currentTicketId, saveCurrentTicket, confirm]);
}
