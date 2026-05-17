import { useState } from "react";
import { copyText } from "../services/clipboardService";
import { useAppStore } from "../services/appStore";
import { Icon } from "./Icon";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onReset?: () => void;
  multiline?: boolean;
  rows?: number;
  warning?: boolean;
  hint?: string;
}

const NOT_PROVIDED = "Not provided";
const NOT_CONFIRMED = "Not confirmed";

export function TicketFieldCard({
  label,
  value,
  onChange,
  onReset,
  multiline,
  rows = 3,
  warning,
  hint,
}: Props) {
  const [copying, setCopying] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const setStatus = useAppStore((s) => s.setStatus);

  const isPlaceholder = value === NOT_PROVIDED || value === NOT_CONFIRMED;
  const showWarning = warning ?? isPlaceholder;

  async function handleCopy() {
    setCopying(true);
    try {
      await copyText(value);
      setStatus({ kind: "success", message: `Copied: ${label}` });
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 1400);
    } catch (e) {
      setStatus({ kind: "error", message: `Copy failed: ${(e as Error).message}` });
    } finally {
      setCopying(false);
    }
  }

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        showWarning
          ? "border-amber-200 bg-amber-50/60 dark:border-amber-800/60 dark:bg-amber-950/30"
          : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/70"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}
          {showWarning && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-800 dark:border-amber-700 dark:bg-amber-900/60 dark:text-amber-200">
              <Icon name="alertTriangle" className="h-2.5 w-2.5" />
              Check
            </span>
          )}
        </label>
        {hint && <span className="text-[10px] text-slate-500 dark:text-slate-500">{hint}</span>}
      </div>

      {multiline ? (
        <textarea
          className="input text-sm"
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          onClick={handleCopy}
          disabled={copying || !value.trim()}
          title={`Copy ${label} to clipboard`}
        >
          <Icon name={justCopied ? "check" : "copy"} className="h-3 w-3" />
          {copying ? "…" : justCopied ? "Copied" : "Copy"}
        </button>
        {onReset && (
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={onReset}
            title="Reset to generated value"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
