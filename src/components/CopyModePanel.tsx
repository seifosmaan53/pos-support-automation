import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../services/appStore";
import { ticketStore } from "../services/databaseService";
import { copyText } from "../services/clipboardService";
import {
  useKeyboardShortcuts,
  modKeyMatcher,
  bareKeyMatcher,
  type KeyboardShortcut,
} from "../hooks/useKeyboardShortcuts";
import {
  resolveDisplayValue,
  resolveLabel,
  type CopyableFieldKey,
  type FieldMappingEntry,
} from "../types/copyMode";
import { buildCopyWarnings } from "../services/copyWarnings";
import { CopyFullTicketMenu } from "./CopyFullTicketMenu";

/**
 * Phase 9: Copy Mode + Sequential Copy Assistant.
 *
 * Behavior:
 *   • Renders fields in the user's real ticketing-system order (driven by
 *     AppSettings.fieldMapping). Each row has: label, generated value,
 *     editable value, copy button, copied badge, shortcut hint.
 *   • A Sequential Copy state machine: Start → step 1 → step 2 → … → Finish.
 *     Buttons are Copy Current, Next, Previous, Skip, Reset, Finish.
 *   • Keyboard shortcuts active only while Copy Mode is on:
 *     Cmd/Ctrl+Shift+C  → copy current
 *     Cmd/Ctrl+ArrowRight → next
 *     Cmd/Ctrl+ArrowLeft  → previous
 *     Cmd/Ctrl+S          → skip current (overrides global Save)
 *     Esc                 → exit copy mode
 *   • Each successful copy is recorded in the ticket's copy_log via
 *     appStore.recordFieldCopied — saved to SQLite.
 *
 * Safety:
 *   • The copy log is informational. The user can still copy any field
 *     manually via the inline button per-row.
 *   • Defaults from FieldMappingEntry.defaultValue stand in when the
 *     generated value is empty. For Contact / Requester / Technician /
 *     Forward To, the row shows "Not provided" rather than an invented
 *     value (per the spec).
 */
export function CopyModePanel({ onExit }: { onExit: () => void }) {
  const fields = useAppStore((s) => s.ticketFields);
  const patchFields = useAppStore((s) => s.patchTicketFields);
  const details = useAppStore((s) => s.details);
  const mapping = useAppStore((s) => s.settings.fieldMapping);
  const recordCopy = useAppStore((s) => s.recordFieldCopied);
  const markComplete = useAppStore((s) => s.markCopySequenceCompleted);
  const resetLog = useAppStore((s) => s.resetCopyLog);
  const setStatus = useAppStore((s) => s.setStatus);
  const currentTicketId = useAppStore((s) => s.currentTicketId);
  const setCopyModeActive = useAppStore((s) => s.setCopyModeActive);

  // Tick used to recompute "copied this session" view from the current
  // ticket's saved copy_log after a write goes through.
  const [refreshTick, setRefreshTick] = useState(0);

  const visibleEntries = useMemo(
    () => mapping.entries.filter((e) => e.enabled),
    [mapping.entries],
  );

  // Build the ordered list of fields the sequence should walk through.
  // We honor `skipIfEmpty` + `mapping.autoSkipEmpty` so the user isn't
  // prompted for a field that would just paste "" into their system.
  const sequence = useMemo(() => {
    return visibleEntries.filter((e) => {
      const val = resolveDisplayValue(fields, e);
      if (e.required) return true;
      if (val.trim()) return true;
      if (e.skipIfEmpty || mapping.autoSkipEmpty) return false;
      return true;
    });
  }, [visibleEntries, fields, mapping.autoSkipEmpty]);

  const [seqActive, setSeqActive] = useState(false);
  const [seqIndex, setSeqIndex] = useState(0);

  // Tag the store so the global Cmd/Ctrl+Shift+C handler yields to ours.
  useEffect(() => {
    setCopyModeActive(true);
    return () => setCopyModeActive(false);
  }, [setCopyModeActive]);

  // Read the live copy log from the saved ticket so the badges are
  // correct even after a re-mount. recordFieldCopied → ticketStore.upsert
  // is synchronous in-memory, so refreshTick is enough to re-pull.
  const copiedFieldKeys = useMemo(() => {
    const set = new Set<CopyableFieldKey>();
    if (!currentTicketId) return set;
    const t = ticketStore.get(currentTicketId);
    for (const e of t?.copyLog ?? []) set.add(e.field);
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTicketId, refreshTick]);

  const warnings = useMemo(
    () => buildCopyWarnings({ details, fields }),
    [details, fields],
  );

  async function handleCopy(entry: FieldMappingEntry) {
    const value = resolveDisplayValue(fields, entry);
    if (!value) {
      setStatus({
        kind: "warning",
        message: `${resolveLabel(entry)} has no value to copy yet.`,
      });
      return;
    }
    try {
      await copyText(value);
      recordCopy(entry.key, value);
      setRefreshTick((n) => n + 1);
      setStatus({ kind: "success", message: `Copied ${resolveLabel(entry)}.` });
    } catch (e) {
      setStatus({ kind: "error", message: `Copy failed: ${(e as Error).message}` });
    }
  }

  async function copyCurrent() {
    if (!seqActive || sequence.length === 0) return;
    const entry = sequence[Math.min(seqIndex, sequence.length - 1)];
    if (!entry) return;
    await handleCopy(entry);
  }
  function nextField() {
    if (!seqActive || sequence.length === 0) return;
    setSeqIndex((i) => Math.min(i + 1, sequence.length - 1));
  }
  function prevField() {
    if (!seqActive || sequence.length === 0) return;
    setSeqIndex((i) => Math.max(i - 1, 0));
  }
  function skipField() {
    if (!seqActive || sequence.length === 0) return;
    setStatus({
      kind: "info",
      message: `Skipped ${resolveLabel(sequence[seqIndex])}.`,
    });
    nextField();
  }
  function startSequence() {
    if (sequence.length === 0) {
      setStatus({
        kind: "warning",
        message: "Nothing in the sequence to copy — adjust field mapping in Settings.",
      });
      return;
    }
    setSeqActive(true);
    setSeqIndex(0);
  }
  function finishSequence() {
    setSeqActive(false);
    markComplete();
  }
  function resetSequence() {
    setSeqActive(false);
    setSeqIndex(0);
    resetLog();
    setRefreshTick((n) => n + 1);
  }

  // ── Scoped keyboard shortcuts ──────────────────────────────────────
  const shortcuts: KeyboardShortcut[] = useMemo(
    () => [
      {
        id: "copy-mode-copy",
        label: "Copy current field",
        combo: "Cmd/Ctrl+Shift+C",
        match: modKeyMatcher("shift+c"),
        handler: () => void copyCurrent(),
      },
      {
        id: "copy-mode-next",
        label: "Next field",
        combo: "Cmd/Ctrl+Right",
        match: modKeyMatcher("arrowright"),
        handler: () => nextField(),
      },
      {
        id: "copy-mode-prev",
        label: "Previous field",
        combo: "Cmd/Ctrl+Left",
        match: modKeyMatcher("arrowleft"),
        handler: () => prevField(),
      },
      {
        id: "copy-mode-skip",
        label: "Skip field",
        combo: "Cmd/Ctrl+S",
        match: modKeyMatcher("s"),
        handler: () => skipField(),
      },
      {
        id: "copy-mode-exit",
        label: "Exit copy mode",
        combo: "Esc",
        match: bareKeyMatcher("Escape"),
        preventDefault: false,
        handler: () => onExit(),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seqActive, seqIndex, sequence, fields, mapping],
  );
  useKeyboardShortcuts(shortcuts);

  const currentEntry = seqActive ? sequence[seqIndex] : null;

  return (
    <section className="card space-y-3 border-emerald-300 dark:border-emerald-700/60">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Copy Mode</h2>
          <p className="text-xs text-slate-500">
            Fields in your ticketing-system paste order. Use the sequential
            assistant or the per-field copy buttons. No automation — clipboard
            only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyFullTicketMenu className="btn-secondary text-xs" />
          <button className="btn-ghost text-xs" onClick={onExit}>
            Exit Copy Mode (Esc)
          </button>
        </div>
      </header>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-700/60 dark:bg-amber-900/20">
          <p className="font-semibold text-amber-800 dark:text-amber-200">
            Heads up before copying — these don't block anything:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-900 dark:text-amber-100">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Sequential Copy Assistant ---------------------------------- */}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Sequential Copy Assistant{" "}
            <span className="text-[11px] font-normal text-slate-500">
              ({copiedFieldKeys.size} copied · {sequence.length} in sequence)
            </span>
          </h3>
          {!seqActive ? (
            <button className="btn-primary text-xs" onClick={startSequence}>
              Start Field Copy Sequence
            </button>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
              Step {Math.min(seqIndex + 1, sequence.length)} / {sequence.length}
            </span>
          )}
        </div>

        {seqActive && currentEntry && (
          <div className="mt-3 space-y-2">
            <div className="rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Up next
              </div>
              <div className="mt-0.5 text-sm font-semibold">
                {resolveLabel(currentEntry)}
              </div>
              <div className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs dark:bg-slate-800/50">
                {resolveDisplayValue(fields, currentEntry) || (
                  <span className="italic text-slate-500">
                    No value yet — Skip to continue, or fill in the editable
                    field below.
                  </span>
                )}
              </div>
              {copiedFieldKeys.has(currentEntry.key) && (
                <div className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                  ✓ Already copied
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary text-xs"
                onClick={() => void copyCurrent()}
                title="Cmd/Ctrl+Shift+C"
              >
                Copy Current Field (Cmd/Ctrl+Shift+C)
              </button>
              <button
                className="btn-secondary text-xs"
                onClick={prevField}
                disabled={seqIndex === 0}
                title="Cmd/Ctrl+←"
              >
                Previous (Cmd/Ctrl+←)
              </button>
              <button
                className="btn-secondary text-xs"
                onClick={nextField}
                disabled={seqIndex >= sequence.length - 1}
                title="Cmd/Ctrl+→"
              >
                Next (Cmd/Ctrl+→)
              </button>
              <button
                className="btn-ghost text-xs"
                onClick={skipField}
                title="Cmd/Ctrl+S"
              >
                Skip (Cmd/Ctrl+S)
              </button>
              <button className="btn-ghost text-xs" onClick={resetSequence}>
                Reset Sequence
              </button>
              <button
                className="btn-secondary text-xs"
                onClick={finishSequence}
              >
                Finish
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Per-field rows ------------------------------------------------ */}
      <ul className="space-y-1.5">
        {visibleEntries.map((entry) => {
          const value = resolveDisplayValue(fields, entry);
          const generated =
            entry.key in fields
              ? (fields as unknown as Record<string, unknown>)[entry.key]
              : "";
          const editable = typeof generated === "string" ? generated : "";
          const copied = copiedFieldKeys.has(entry.key);
          const isCurrent = seqActive && currentEntry?.key === entry.key;
          return (
            <li
              key={entry.key}
              className={`rounded-md border p-2 text-xs ${
                isCurrent
                  ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20"
                  : entry.required && !value
                    ? "border-amber-300 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-900/20"
                    : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="text-[11px] uppercase tracking-wide text-slate-500">
                    {resolveLabel(entry)}
                  </span>
                  {entry.required && (
                    <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      Required
                    </span>
                  )}
                  {copied && (
                    <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                      ✓ Copied
                    </span>
                  )}
                  {isCurrent && (
                    <span className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
                      Current step
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => void handleCopy(entry)}
                  disabled={!value}
                  title={
                    value
                      ? `Copy ${resolveLabel(entry)}`
                      : "No value to copy yet"
                  }
                >
                  Copy
                </button>
              </div>
              <div className="mt-1 space-y-1">
                <div className="rounded bg-slate-50 px-2 py-1 text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                  {value || <span className="italic text-slate-500">Empty</span>}
                </div>
                <input
                  className="input w-full text-xs"
                  value={editable}
                  onChange={(e) =>
                    patchFields({ [entry.key]: e.target.value } as Record<string, string>)
                  }
                  placeholder="Edit before copying — no overwrite of generated value"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
