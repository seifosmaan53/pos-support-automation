/**
 * Phase 12B — three-step audio repair wizard.
 *
 * Step 1: Missing rows (SQLite says it exists; disk says it doesn't).
 * Step 2: Orphan rows (rows with no ticket / ticket-not-found / deleted-but-on-disk).
 * Step 3: Files on disk not linked to any active row.
 *
 * Every destructive action goes through useConfirm. After every action the
 * wizard re-scans so before/after counts stay live without the user having
 * to click "Refresh".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { ticketStore } from "../services/databaseService";
import {
  attachDiskFileToTicket,
  attachReplacementForRow,
  deleteAudioMetadata,
  deleteDiskFile,
  importDiskFileAsUnlinked,
  linkAudioToTicket,
  markAudioRowMissing,
  relocateAudioRow,
  revealAudioRowInFolder,
  scanAudioHealth,
  toCounts,
  type AudioHealthCounts,
  type AudioHealthScan,
  type MissingAudioRow,
  type OrphanAudioRow,
  type UnlinkedDiskFile,
} from "../services/audioRepair";
import { formatDateTime } from "../utils/formatDate";
import { isTauriDesktop, openInFolder } from "../services/systemStorage";

export interface AudioRepairWizardProps {
  /** When false the modal is unmounted. */
  open: boolean;
  onClose: () => void;
  /** Called after each successful action so the parent (System Health) can
   *  refresh its counts and the backup-first prompt. */
  onChange?: () => void;
}

type WizardStep = 1 | 2 | 3;

export function AudioRepairWizard({
  open,
  onClose,
  onChange,
}: AudioRepairWizardProps) {
  const confirm = useConfirm();
  const [step, setStep] = useState<WizardStep>(1);
  const [scan, setScan] = useState<AudioHealthScan | null>(null);
  const [initialCounts, setInitialCounts] = useState<AudioHealthCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await scanAudioHealth();
      setScan(next);
      if (initialCounts === null) {
        setInitialCounts(toCounts(next));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [initialCounts]);

  // Reset when the modal opens — we want fresh "before" counts each session.
  useEffect(() => {
    if (open) {
      setInitialCounts(null);
      setStep(1);
      void refresh();
    } else {
      setScan(null);
      setInitialCounts(null);
      setBusyRow(null);
      setError(null);
    }
    // We intentionally re-run when `open` toggles; `refresh` captures
    // initialCounts via closure, but that's by-design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const current = scan ? toCounts(scan) : { missing: 0, orphan: 0, unlinkedOnDisk: 0 };

  const handleAction = useCallback(
    async (rowKey: string, action: () => Promise<void> | void) => {
      setBusyRow(rowKey);
      setError(null);
      try {
        await action();
        await refresh();
        onChange?.();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusyRow(null);
      }
    },
    [refresh, onChange],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Repair Audio Records</h2>
            <button
              type="button"
              className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Step through the three audio-health categories. Every destructive
            action asks for confirmation. We re-scan after each action so the
            counts below stay accurate.
          </p>
          <StepHeader step={step} counts={current} onSelect={setStep} />
          <BeforeAfter initial={initialCounts} current={current} />
        </div>

        <div className="px-5 py-4">
          {loading && (
            <div className="text-sm text-slate-500">Scanning…</div>
          )}
          {error && (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
          {!loading && scan && step === 1 && (
            <Step1Missing
              rows={scan.missing}
              busyRow={busyRow}
              confirm={confirm}
              onAction={handleAction}
            />
          )}
          {!loading && scan && step === 2 && (
            <Step2Orphan
              rows={scan.orphan}
              busyRow={busyRow}
              confirm={confirm}
              onAction={handleAction}
            />
          )}
          {!loading && scan && step === 3 && (
            <Step3DiskUnlinked
              rows={scan.unlinkedOnDisk}
              busyRow={busyRow}
              confirm={confirm}
              onAction={handleAction}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <div className="text-xs text-slate-500">
            {scan && (
              <>
                Active rows: {scan.activeRows} · Files on disk: {scan.filesOnDisk}
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void refresh()}
              disabled={loading}
            >
              Re-scan
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepHeader({
  step,
  counts,
  onSelect,
}: {
  step: WizardStep;
  counts: AudioHealthCounts;
  onSelect: (s: WizardStep) => void;
}) {
  const tabs: { step: WizardStep; label: string; count: number }[] = [
    { step: 1, label: "Missing files", count: counts.missing },
    { step: 2, label: "Orphan rows", count: counts.orphan },
    { step: 3, label: "Unlinked on disk", count: counts.unlinkedOnDisk },
  ];
  return (
    <div className="mt-3 flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {tabs.map((t) => {
        const active = step === t.step;
        return (
          <button
            key={t.step}
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                : "text-slate-600 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-900/40"
            }`}
            onClick={() => onSelect(t.step)}
          >
            Step {t.step}: {t.label}
            {t.count > 0 && (
              <span
                className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                  active
                    ? "bg-slate-200 dark:bg-slate-700"
                    : "bg-white/70 dark:bg-slate-900/60"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function BeforeAfter({
  initial,
  current,
}: {
  initial: AudioHealthCounts | null;
  current: AudioHealthCounts;
}) {
  if (!initial) return null;
  const changed =
    initial.missing !== current.missing ||
    initial.orphan !== current.orphan ||
    initial.unlinkedOnDisk !== current.unlinkedOnDisk;
  if (!changed) return null;
  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
      <div className="font-medium">Repair progress</div>
      <div>
        Missing: {initial.missing} → <strong>{current.missing}</strong> · Orphan:{" "}
        {initial.orphan} → <strong>{current.orphan}</strong> · Unlinked:{" "}
        {initial.unlinkedOnDisk} → <strong>{current.unlinkedOnDisk}</strong>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step 1 — Missing audio rows
// ────────────────────────────────────────────────────────────────────────────

interface StepProps<T> {
  rows: T[];
  busyRow: string | null;
  confirm: ReturnType<typeof useConfirm>;
  onAction: (rowKey: string, action: () => Promise<void> | void) => Promise<void>;
}

function Step1Missing({
  rows,
  busyRow,
  confirm,
  onAction,
}: StepProps<MissingAudioRow>) {
  if (rows.length === 0) {
    return (
      <Empty
        title="No missing audio files."
        body="Every active audio row points at a file that exists on disk."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const key = `m:${row.audio.id}`;
        const busy = busyRow === key;
        return (
          <li
            key={key}
            className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-xs text-slate-500">
                  {row.audio.id}
                </div>
                <div className="mt-0.5 truncate text-sm font-medium">
                  {row.linkedTicketSubject ?? (
                    <span className="text-slate-500">(no linked ticket)</span>
                  )}
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-xs text-slate-600 dark:text-slate-400"
                  title={row.expectedPath}
                >
                  Expected: {row.expectedPath}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Created: {formatDateTime(row.createdAt)} · Deleted flag:{" "}
                  {row.deleted ? "yes" : "no"} · Ticket id:{" "}
                  {row.linkedTicketId ? row.linkedTicketId.slice(0, 8) : "—"}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const picked = await pickFile([
                        "wav",
                        "mp3",
                        "m4a",
                        "webm",
                        "ogg",
                      ]);
                      if (!picked) return;
                      if (!relocateAudioRow(row.audio.id, picked)) {
                        throw new Error("Row not found.");
                      }
                    })
                  }
                >
                  Locate File
                </button>
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const picked = await pickFile([
                        "wav",
                        "mp3",
                        "m4a",
                        "webm",
                        "ogg",
                      ]);
                      if (!picked) return;
                      const ok = await confirm({
                        title: "Attach replacement file?",
                        message:
                          "The chosen file will be copied into the app audio folder and this row will be updated to point at the new copy. The original file you picked is left untouched.",
                        confirmLabel: "Attach replacement",
                      });
                      if (!ok) return;
                      await attachReplacementForRow(row.audio.id, picked);
                    })
                  }
                >
                  Attach Replacement
                </button>
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const ok = await confirm({
                        title: "Mark audio missing?",
                        message:
                          "The audio row will be flagged as deleted, so the linked ticket shows 'Audio deleted/missing'. The row stays in the audit trail. You can re-attach later.",
                        confirmLabel: "Mark missing",
                        destructive: true,
                      });
                      if (!ok) return;
                      markAudioRowMissing(row.audio.id);
                    })
                  }
                >
                  Mark Audio Missing
                </button>
                <button
                  className="btn-ghost text-xs text-red-600 dark:text-red-400"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const ok = await confirm({
                        title: "Delete audio metadata?",
                        message:
                          "The audio row will be hidden (soft-deleted). It remains in the database for audit purposes but no longer appears in History. This cannot be undone from the UI.",
                        confirmLabel: "Delete metadata",
                        destructive: true,
                      });
                      if (!ok) return;
                      deleteAudioMetadata(row.audio.id);
                    })
                  }
                >
                  Delete Metadata
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step 2 — Orphan rows
// ────────────────────────────────────────────────────────────────────────────

function Step2Orphan({
  rows,
  busyRow,
  confirm,
  onAction,
}: StepProps<OrphanAudioRow>) {
  if (rows.length === 0) {
    return (
      <Empty
        title="No orphan audio rows."
        body="Every audio row links to a saved ticket."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const key = `o:${row.audio.id}`;
        const busy = busyRow === key;
        return (
          <li
            key={key}
            className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-xs text-slate-500">
                  {row.audio.id}
                </div>
                <div className="mt-0.5 text-sm font-medium text-amber-700 dark:text-amber-300">
                  {row.reasonText}
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-xs text-slate-600 dark:text-slate-400"
                  title={row.audio.path}
                >
                  {row.audio.path}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Created: {formatDateTime(row.audio.createdAt)} · Ticket id:{" "}
                  {row.linkedTicketId ? row.linkedTicketId.slice(0, 8) : "—"} ·
                  File exists: {row.fileExists ? "yes" : "no"}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const ticketId = await pickTicketId(confirm);
                      if (!ticketId) return;
                      const ok = linkAudioToTicket(row.audio.id, ticketId);
                      if (!ok) throw new Error("Could not link — ticket not found.");
                    })
                  }
                >
                  Link to Ticket
                </button>
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const ok = await confirm({
                        title: "Mark deleted?",
                        message:
                          "The row will be flagged deleted. The file on disk is not touched.",
                        confirmLabel: "Mark deleted",
                        destructive: true,
                      });
                      if (!ok) return;
                      markAudioRowMissing(row.audio.id);
                    })
                  }
                >
                  Mark Deleted
                </button>
                <button
                  className="btn-ghost text-xs text-red-600 dark:text-red-400"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const ok = await confirm({
                        title: "Delete metadata?",
                        message:
                          "The row will be hidden from active listings. The file on disk is not touched.",
                        confirmLabel: "Delete metadata",
                        destructive: true,
                      });
                      if (!ok) return;
                      deleteAudioMetadata(row.audio.id);
                    })
                  }
                >
                  Delete Metadata
                </button>
                {row.fileExists && isTauriDesktop() && (
                  <button
                    className="btn-ghost text-xs"
                    disabled={busy}
                    onClick={() =>
                      void onAction(key, () => revealAudioRowInFolder(row.audio.id))
                    }
                  >
                    Open File Location
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step 3 — Files on disk not linked to tickets
// ────────────────────────────────────────────────────────────────────────────

function Step3DiskUnlinked({
  rows,
  busyRow,
  confirm,
  onAction,
}: StepProps<UnlinkedDiskFile>) {
  if (rows.length === 0) {
    return (
      <Empty
        title="No unlinked files on disk."
        body="Every WAV in the audio folder is linked to an active audio row."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((f) => {
        const key = `d:${f.path}`;
        const busy = busyRow === key;
        const sizeMb = (f.sizeBytes / (1024 * 1024)).toFixed(1);
        const when = f.modifiedMs
          ? formatDateTime(new Date(f.modifiedMs).toISOString())
          : "(unknown)";
        return (
          <li
            key={key}
            className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-slate-700 dark:text-slate-300">
                  {f.filename}
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-xs text-slate-500"
                  title={f.path}
                >
                  {f.path}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Modified: {when} · Size: {sizeMb} MB
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const ticketId = await pickTicketId(confirm);
                      if (!ticketId) return;
                      const row = attachDiskFileToTicket(f.path, ticketId);
                      if (!row) throw new Error("Ticket not found.");
                    })
                  }
                >
                  Attach to Ticket
                </button>
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const ok = await confirm({
                        title: "Import as unlinked recording?",
                        message:
                          "An audio_files row will be created for this file with no ticket attached. You can link it later from System Health.",
                        confirmLabel: "Import",
                      });
                      if (!ok) return;
                      importDiskFileAsUnlinked(f.path);
                    })
                  }
                >
                  Import Unlinked
                </button>
                {isTauriDesktop() && (
                  <button
                    className="btn-ghost text-xs"
                    disabled={busy}
                    onClick={() => {
                      const sep = f.path.lastIndexOf("/");
                      const dir = sep > 0 ? f.path.slice(0, sep) : f.path;
                      void openInFolder(dir);
                    }}
                  >
                    Open Location
                  </button>
                )}
                <button
                  className="btn-ghost text-xs text-red-600 dark:text-red-400"
                  disabled={busy}
                  onClick={() =>
                    void onAction(key, async () => {
                      const ok = await confirm({
                        title: "Delete this file?",
                        message: `${f.filename} will be permanently removed from disk. This cannot be undone.`,
                        confirmLabel: "Delete file",
                        destructive: true,
                      });
                      if (!ok) return;
                      await deleteDiskFile(f.path);
                    })
                  }
                >
                  Delete File
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
      <div className="font-medium">{title}</div>
      <div className="text-xs opacity-80">{body}</div>
    </div>
  );
}

async function pickFile(extensions: string[]): Promise<string | null> {
  if (!isTauriDesktop()) {
    throw new Error("Picking files requires the Tauri desktop app.");
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const chosen = await open({
    multiple: false,
    filters: [{ name: "Audio", extensions }],
  });
  if (!chosen || Array.isArray(chosen)) return null;
  return chosen;
}

/**
 * Prompt the user to choose a ticket ID. We use the simplest UX possible
 * here — a confirm-with-message dialog whose text shows a numbered list of
 * recent tickets, plus a window.prompt for the actual ID input. This avoids
 * shipping a full ticket-picker UI for what is a recovery flow most users
 * will hit zero times.
 */
async function pickTicketId(
  confirmFn: ReturnType<typeof useConfirm>,
): Promise<string | null> {
  const tickets = ticketStore.list().slice(0, 30);
  if (tickets.length === 0) {
    await confirmFn({
      title: "No tickets",
      message: "There are no saved tickets to link to. Save a ticket first.",
      confirmLabel: "OK",
    });
    return null;
  }
  const list = tickets
    .map((t, i) => {
      const subj =
        t.ticketFields?.subject?.trim() ||
        t.details?.issue?.trim() ||
        `Ticket ${t.id.slice(0, 8)}`;
      return `${i + 1}. [${t.id.slice(0, 8)}] ${subj}`;
    })
    .join("\n");
  // window.prompt is the simplest cross-platform input for an ID; the
  // confirmFn above is just used to surface the "no tickets" message in the
  // app's own modal style.
  const raw = typeof window === "undefined" ? null : window.prompt(
    `Enter the 8-character prefix of the ticket to link to:\n\n${list}`,
  );
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  const match = tickets.find((t) => t.id.toLowerCase().startsWith(trimmed));
  return match ? match.id : null;
}
