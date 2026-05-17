/**
 * Phase 11D — workflow step indicator.
 *
 * A single horizontal strip showing where the user is in the main ticket
 * pipeline:
 *
 *   1. Record / Paste   2. Review   3. Ticket Fields   4. Copy   5. Save
 *
 * Step derivation is purely from store state (transcript present? stage?
 * currentTicketId?), so the indicator stays in sync when the user
 * navigates between pages — no per-page prop required.
 */

import { useAppStore } from "../services/appStore";

const STEPS = [
  { id: 1, label: "Record / Paste" },
  { id: 2, label: "Review" },
  { id: 3, label: "Ticket Fields" },
  { id: 4, label: "Copy" },
  { id: 5, label: "Save" },
] as const;

export function WorkflowSteps() {
  const transcript = useAppStore((s) => s.transcript);
  const stage = useAppStore((s) => s.stage);
  const currentTicketId = useAppStore((s) => s.currentTicketId);
  const generatedTicket = useAppStore((s) => s.generatedTicket);

  const current = deriveCurrentStep({
    hasTranscript: !!transcript.trim(),
    stage,
    hasGeneratedFields: !!generatedTicket.trim(),
    hasSavedTicket: !!currentTicketId,
  });

  return (
    <nav
      aria-label="Workflow progress"
      className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-xl border border-slate-200/70 bg-white/60 px-3 py-2 text-[12px] dark:border-slate-800/70 dark:bg-slate-900/40"
    >
      {STEPS.map((step, idx) => {
        const isCurrent = step.id === current;
        const isDone = step.id < current;
        return (
          <div key={step.id} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${
                isCurrent
                  ? "border-brand-500 bg-brand-600 text-white"
                  : isDone
                    ? "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : "border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
              }`}
            >
              {isDone ? "✓" : step.id}
            </span>
            <span
              className={
                isCurrent
                  ? "font-semibold text-slate-900 dark:text-slate-50"
                  : "text-slate-500 dark:text-slate-400"
              }
            >
              {step.label}
            </span>
            {idx < STEPS.length - 1 && (
              <span className="mx-1 hidden text-slate-300 dark:text-slate-700 sm:inline">
                →
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}

interface DeriveInput {
  hasTranscript: boolean;
  stage: ReturnType<typeof useAppStore.getState>["stage"];
  hasGeneratedFields: boolean;
  hasSavedTicket: boolean;
}

export function deriveCurrentStep(input: DeriveInput): number {
  if (input.hasSavedTicket) return 5; // Save
  if (input.stage === "form") return 4; // Copy
  if (input.hasGeneratedFields || input.stage === "details" || input.stage === "ticket") {
    return 3; // Ticket Fields
  }
  if (input.hasTranscript) return 2; // Review
  return 1; // Record / Paste
}
