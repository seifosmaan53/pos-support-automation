import { Link } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import type { StartupWarning } from "../services/startupSafety";

/**
 * Phase 12 — non-blocking startup-warning banner.
 *
 * Renders above the main content on every route. Each entry is dismissible
 * individually for the session. Severity → border colour mapping:
 *   error    → red (SQLite fallback, etc.)
 *   warning  → amber (missing audio, broken whisper)
 *   info     → sky (due reminders, optional setup)
 */
export function StartupWarningBanner() {
  const warnings = useAppStore((s) => s.startupWarnings);
  const dismissed = useAppStore((s) => s.dismissedStartupWarnings);
  const dismiss = useAppStore((s) => s.dismissStartupWarning);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const visible = warnings.filter((w) => !dismissed.includes(w.id));
  if (visible.length === 0) return null;

  // Phase 16D follow-up — one-click "Switch to rule-based" for the AI
  // provider unreachable banners. We don't add a generic action callback
  // to the StartupWarning type; instead we detect the id prefix and
  // inject the action contextually. The dismissal id stays the same, so
  // the persistence machinery still works the moment the banner clears.
  const switchToRuleBased = (id: string) => {
    updateSettings({ aiProvider: "rule-based" });
    dismiss(id);
  };

  return (
    <div className="space-y-1 px-4 pt-3">
      {visible.map((w) => (
        <Row
          key={w.id}
          warning={w}
          onDismiss={() => dismiss(w.id)}
          onSwitchToRuleBased={
            w.id.startsWith("ollama-unreachable:") ||
            w.id.startsWith("lmstudio-unreachable:")
              ? () => switchToRuleBased(w.id)
              : undefined
          }
        />
      ))}
    </div>
  );
}

function Row({
  warning,
  onDismiss,
  onSwitchToRuleBased,
}: {
  warning: StartupWarning;
  onDismiss: () => void;
  onSwitchToRuleBased?: () => void;
}) {
  const tone =
    warning.severity === "error"
      ? "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200"
      : warning.severity === "warning"
        ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        : "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200";
  return (
    <div
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${tone}`}
      role={warning.severity === "info" ? "status" : "alert"}
    >
      <span className="flex-1">{warning.message}</span>
      {onSwitchToRuleBased && (
        <button
          type="button"
          className="font-medium underline"
          onClick={onSwitchToRuleBased}
          title="Set AI Provider to Rule-based and dismiss this banner."
        >
          Switch to rule-based
        </button>
      )}
      {warning.link && (
        <Link to={warning.link.to} className="font-medium underline">
          {warning.link.label}
        </Link>
      )}
      <button
        type="button"
        className="text-xs opacity-60 hover:opacity-100"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
