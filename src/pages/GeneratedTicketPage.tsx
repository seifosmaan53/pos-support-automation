import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { DetailLevelSelector } from "../components/DetailLevelSelector";
import { CopyButton } from "../components/CopyButton";
import { WarningBox } from "../components/WarningBox";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";
import type { DetailLevel } from "../types/ticket";

export function GeneratedTicketPage() {
  const generated = useAppStore((s) => s.generatedTicket);
  const setGenerated = useAppStore((s) => s.setGeneratedTicket);
  const detailLevel = useAppStore((s) => s.detailLevel);
  const details = useAppStore((s) => s.details);
  const generate = useAppStore((s) => s.generate);
  const save = useAppStore((s) => s.saveCurrentTicket);
  const busy = useAppStore((s) => s.busy);
  const navigate = useNavigate();

  const hasGenerated = generated.trim().length > 0;
  const hasAnalysis = details.issue.trim().length > 0 || details.storeNumber.trim().length > 0;

  function regenerateAt(level: DetailLevel) {
    if (busy) return;
    void generate({ detailLevel: level });
  }

  function exportTxt() {
    const blob = new Blob([generated], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const store = details.storeNumber || "ticket";
    a.download = `store-${store}-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="page-title">Generated Note</h1>
          <p className="page-subtitle">
            Single-paragraph note built from extracted fields. Use this when you only need one
            block of text — for the full ticket form, see <strong>Ticket Form Helper</strong>.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => navigate("/form")}>
          Open Ticket Form Helper
        </button>
      </header>

      {!hasAnalysis && (
        <EmptyState
          icon="doc"
          title="Generate a one-paragraph note"
          description="The note builds from extracted details. Add a transcript and click Analyze first — then come back here to copy or save it."
          cta={{ label: "Go to Voice Ticket", to: "/voice" }}
        />
      )}

      {hasAnalysis && (
        <>
          <WarningBox tone="warning" title="Review before submitting">
            Always check the wording matches what really happened. Never submit a ticket that says an
            issue was resolved unless it actually was.
          </WarningBox>

          <section className="card space-y-3">
            <div className="label">Detail level</div>
            <DetailLevelSelector
              value={detailLevel}
              onChange={regenerateAt}
              disabled={busy === "generating"}
            />
          </section>

          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="label">Ticket note</div>
              <div className="text-xs text-slate-500">Editable — your edits are kept.</div>
            </div>
            <textarea
              className="input min-h-[180px] text-base leading-relaxed"
              rows={8}
              value={generated}
              onChange={(e) => setGenerated(e.target.value)}
              placeholder="Click Generate to build the note from extracted details."
            />

            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary"
                onClick={() => generate()}
                disabled={busy === "generating" || !hasAnalysis}
              >
                {busy === "generating" ? (
                  <>
                    <Spinner className="h-3.5 w-3.5" />
                    Generating…
                  </>
                ) : hasGenerated ? (
                  "Regenerate"
                ) : (
                  "Generate"
                )}
              </button>
              <CopyButton text={generated} label="Copy to Clipboard" className="btn-secondary" />
              <button
                className="btn-secondary"
                onClick={async () => {
                  await save();
                  navigate("/history");
                }}
                disabled={!hasGenerated}
                title={
                  hasGenerated
                    ? "Save to local history and open History"
                    : "Generate the note first."
                }
              >
                Save Ticket
              </button>
              <button
                className="btn-secondary"
                onClick={exportTxt}
                disabled={!hasGenerated}
                title={hasGenerated ? "Download as a .txt file" : "Generate the note first."}
              >
                Export as TXT
              </button>
              <span className="ml-auto self-center text-[11px] text-slate-500">
                <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>S</kbd> to save
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
