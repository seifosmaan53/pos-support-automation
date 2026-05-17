import { useEffect } from "react";

export interface KeyboardShortcut {
  id: string;
  label: string;
  combo: string;
  match: (e: KeyboardEvent) => boolean;
  handler: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
}

/**
 * Match `(Cmd|Ctrl) + key` regardless of OS.
 * Use lowercase for `key`. For Shift modifier, prefix with "shift+".
 */
export function modKeyMatcher(key: string): (e: KeyboardEvent) => boolean {
  const wantsShift = key.startsWith("shift+");
  const k = (wantsShift ? key.slice(6) : key).toLowerCase();
  return (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return false;
    if (wantsShift && !e.shiftKey) return false;
    if (!wantsShift && e.shiftKey) return false;
    return e.key.toLowerCase() === k;
  };
}

export function bareKeyMatcher(key: string): (e: KeyboardEvent) => boolean {
  return (e) =>
    e.key === key && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // While typing, suppress bare-key shortcuts so the user can type "s" without
      // saving. Modifier-key shortcuts (Cmd/Ctrl/Alt) and Esc still fire — those
      // are clearly intentional commands, not text input.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const isEditing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable === true;
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey;

      for (const sc of shortcuts) {
        if (!sc.match(e)) continue;
        if (isEditing && !hasModifier && e.key !== "Escape") continue;
        if (sc.preventDefault !== false) e.preventDefault();
        sc.handler(e);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);
}
