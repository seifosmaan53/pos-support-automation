import { useEffect, useState } from "react";
import { WarningBox } from "./WarningBox";
import {
  deleteLegacyLocalStorageTickets,
  exportLocalStorageBackup,
  getMigrationStatus,
  runMigration,
  verifyMigration,
  type MigrationStatus,
} from "../services/storageMigration";
import { getStorageBackend } from "../services/databaseService";
import { isTauriAvailable } from "../services/sqliteClient";
import { useConfirm } from "./ConfirmDialog";

type ToastKind = "info" | "success" | "warning" | "error";

interface Props {
  onStatus: (s: { kind: ToastKind; message: string }) => void;
}

const STATUS_LABEL: Record<MigrationStatus["kind"], string> = {
  no_data: "No data to migrate",
  not_started: "Not started",
  migrated: "Migrated",
  failed: "Failed",
};

const STATUS_TONE: Record<MigrationStatus["kind"], "info" | "warning" | "success" | "danger"> = {
  no_data: "info",
  not_started: "warning",
  migrated: "success",
  failed: "danger",
};

export function MigrationPanel({ onStatus }: Props) {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [busy, setBusy] = useState<null | "run" | "verify" | "backup" | "delete">(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifiedOk, setVerifiedOk] = useState(false);
  const [backup, setBackup] = useState<string | null>(null);
  const askConfirm = useConfirm();

  const tauriPresent = isTauriAvailable();
  const backend = getStorageBackend();

  async function refresh() {
    try {
      const s = await getMigrationStatus();
      setStatus(s);
    } catch (e) {
      onStatus({ kind: "error", message: `Could not read migration status: ${(e as Error).message}` });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleRun() {
    setBusy("run");
    setVerifyMsg(null);
    setVerifiedOk(false);
    try {
      const r = await runMigration();
      if (r.errors.length === 0) {
        onStatus({
          kind: "success",
          message: `Migrated ${r.succeeded} of ${r.attempted} ticket(s) into SQLite.`,
        });
      } else {
        onStatus({
          kind: "error",
          message: `Migration finished with ${r.errors.length} error(s). Check console for details.`,
        });
      }
      await refresh();
    } catch (e) {
      onStatus({ kind: "error", message: `Migration failed: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function handleVerify() {
    setBusy("verify");
    try {
      const r = await verifyMigration();
      if (r.matches) {
        setVerifyMsg(
          `Verified — ${r.localStorageCount} localStorage ticket(s) all present in SQLite (backend has ${r.backendCount}).`,
        );
        setVerifiedOk(true);
        onStatus({ kind: "success", message: "Migration verified." });
      } else {
        setVerifyMsg(
          `Mismatch: ${r.missingIds.length} localStorage ticket(s) missing from SQLite. ` +
            `Re-run migration before deleting old data. First few missing IDs: ${r.missingIds.slice(0, 3).join(", ")}`,
        );
        setVerifiedOk(false);
        onStatus({
          kind: "error",
          message: `${r.missingIds.length} ticket(s) missing in SQLite — do not delete old data yet.`,
        });
      }
    } catch (e) {
      onStatus({ kind: "error", message: `Verify failed: ${(e as Error).message}` });
      setVerifiedOk(false);
    } finally {
      setBusy(null);
    }
  }

  function handleExport() {
    setBusy("backup");
    try {
      const json = exportLocalStorageBackup();
      setBackup(json);
      // Also trigger a file download so the user can save it without copy/paste.
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sta-localstorage-backup-${stamp()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onStatus({ kind: "success", message: "Backup file downloaded." });
    } catch (e) {
      onStatus({ kind: "error", message: `Backup failed: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteOld() {
    if (!verifiedOk) {
      onStatus({
        kind: "warning",
        message: "Run Verify Migration first and confirm parity before deleting old data.",
      });
      return;
    }
    const ok = await askConfirm({
      title: "Delete legacy localStorage tickets?",
      message:
        "Your data will remain in SQLite. This action is irreversible — make sure you have a backup file from Export Backup.",
      destructive: true,
      confirmLabel: "Delete legacy data",
    });
    if (!ok) return;
    setBusy("delete");
    try {
      deleteLegacyLocalStorageTickets();
      onStatus({ kind: "success", message: "Legacy localStorage tickets deleted." });
      void refresh();
    } catch (e) {
      onStatus({ kind: "error", message: `Delete failed: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return (
      <p className="text-xs text-slate-500">Checking migration status…</p>
    );
  }

  const canRunMigration =
    tauriPresent && backend === "sqlite" && status.kind !== "no_data";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Storage backend:</span>
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100">
          {backend}
        </span>
        <span className="text-slate-500">Migration status:</span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            STATUS_TONE[status.kind] === "success"
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
              : STATUS_TONE[status.kind] === "warning"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                : STATUS_TONE[status.kind] === "danger"
                  ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                  : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
          }`}
        >
          {STATUS_LABEL[status.kind]}
        </span>
        {status.completedAt && (
          <span className="text-xs text-slate-500">at {status.completedAt}</span>
        )}
      </div>

      <div className="text-xs text-slate-500">
        localStorage holds {status.localStorageCount} ticket(s); active backend holds{" "}
        {status.backendCount}.
      </div>

      {!tauriPresent && (
        <WarningBox tone="info">
          You're running outside the Tauri desktop app (likely Vite browser preview). SQLite is not
          available here — the app stays on localStorage. Open the desktop app to migrate.
        </WarningBox>
      )}

      {tauriPresent && backend === "localStorage" && (
        <WarningBox tone="warning">
          SQLite did not initialize on this boot, so the app fell back to localStorage. Restart the
          app; if the problem persists, check the developer console for details.
        </WarningBox>
      )}

      {status.kind === "failed" && status.error && (
        <WarningBox tone="danger">
          Last migration attempt failed:
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs">
            {status.error}
          </pre>
        </WarningBox>
      )}

      {verifyMsg && (
        <WarningBox tone={verifiedOk ? "success" : "danger"}>{verifyMsg}</WarningBox>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          onClick={handleRun}
          disabled={!canRunMigration || busy !== null}
        >
          {busy === "run" ? "Migrating…" : "Run Migration"}
        </button>
        <button
          className="btn-secondary"
          onClick={handleVerify}
          disabled={!tauriPresent || backend !== "sqlite" || busy !== null}
        >
          {busy === "verify" ? "Verifying…" : "Verify Migration"}
        </button>
        <button
          className="btn-secondary"
          onClick={handleExport}
          disabled={status.localStorageCount === 0 || busy !== null}
          title="Download a JSON backup of the legacy localStorage tickets"
        >
          {busy === "backup" ? "Exporting…" : "Export Backup"}
        </button>
        <button
          className="btn-danger"
          onClick={handleDeleteOld}
          disabled={status.localStorageCount === 0 || !verifiedOk || busy !== null}
          title={
            verifiedOk
              ? "Delete the legacy localStorage tickets (verified safe)"
              : "Run Verify Migration first to enable this"
          }
        >
          {busy === "delete" ? "Deleting…" : "Delete Old localStorage Data"}
        </button>
      </div>

      {backup && (
        <details className="rounded border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-900/40">
          <summary className="cursor-pointer">Backup JSON (also downloaded as a file)</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{backup}</pre>
        </details>
      )}
    </div>
  );
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}
