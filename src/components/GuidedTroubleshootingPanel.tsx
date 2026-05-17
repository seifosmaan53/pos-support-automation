import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import {
  guidedTroubleshootingSteps,
  partRequestSuggestion,
  relevantKnowledgeForCurrent,
  type GuidedStepGroup,
  type KnowledgeRelevance,
} from "../services/knowledgeIntelligence";
import { labelForKnowledgeType } from "../types/knowledge";
import { Icon } from "./Icon";

/**
 * Phase 7 panel for the Ticket Form Helper page.
 *
 * Shows knowledge-driven guidance for the current ticket:
 *   • Guided steps from stored troubleshooting_guide items + built-in
 *     defaults that match the detected issue (Inseego, register keyboard,
 *     receipt printer, VeriFone, BOS, …)
 *   • A "Suggested Part Request" hint when a part_request_rule matches
 *     and no exclude phrase is present
 *   • A short list of related knowledge items the user can review
 *
 * Critical safety rule: every step in this panel is *suggested*, never
 * marked as completed in the ticket. The ticket fields stay sourced from
 * the transcript / extracted details. The panel exists to help the
 * technician — it never invents work.
 */
export function GuidedTroubleshootingPanel() {
  const details = useAppStore((s) => s.details);
  const transcript = useAppStore((s) => s.transcript);
  const fields = useAppStore((s) => s.ticketFields);
  const navigate = useNavigate();

  const groups: GuidedStepGroup[] = useMemo(() => {
    return guidedTroubleshootingSteps({ details, transcript, fields });
  }, [details, transcript, fields]);

  const partSuggestion = useMemo(
    () => partRequestSuggestion({ details, transcript, fields }),
    [details, transcript, fields],
  );

  const relevance: KnowledgeRelevance[] = useMemo(
    () => relevantKnowledgeForCurrent({ details, transcript, fields }, 4),
    [details, transcript, fields],
  );

  // No relevant knowledge AND no built-in matches → don't render the panel.
  // Avoids visual clutter on calls that don't trigger any guidance.
  if (groups.length === 0 && !partSuggestion && relevance.length === 0) {
    return null;
  }

  return (
    <section className="card space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            <Icon name="shield" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Guided Troubleshooting</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Suggested steps and related knowledge for the detected issue.
              None of these are written into the ticket — confirm with the
              caller and edit fields manually.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => navigate("/knowledge")}
          title="Open the Knowledge Base to add or edit items."
        >
          <Icon name="arrowRight" className="h-3.5 w-3.5" />
          Open Knowledge Base
        </button>
      </header>

      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((g, idx) => (
            <article
              key={`${g.sourceId || "builtin"}-${idx}`}
              className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{g.title}</h3>
                <span className={g.sourceId ? "badge-brand" : "badge-neutral"}>
                  {g.sourceId ? "From your KB" : "Built-in"}
                </span>
              </header>

              {g.steps.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold uppercase text-slate-500">
                    Suggested steps
                  </p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                    {g.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}

              {g.warnings.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold uppercase text-amber-700 dark:text-amber-300">
                    Warnings
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-800 dark:text-amber-200">
                    {g.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {g.questions.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold uppercase text-slate-500">
                    Suggested questions to confirm
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                    {g.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {partSuggestion && (
        <article className="rounded-xl border border-orange-200 bg-orange-50/70 p-4 text-sm dark:border-orange-800/60 dark:bg-orange-950/30">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-orange-900 dark:text-orange-100">
              <Icon name="alertTriangle" className="h-3.5 w-3.5" />
              Suggested Part Request
            </h3>
            <span className="badge border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-800/70 dark:bg-orange-900/60 dark:text-orange-200">
              From your KB
            </span>
          </header>
          <p className="mt-2 text-orange-900 dark:text-orange-100">
            <strong>{partSuggestion.partLabel}</strong> may be needed —{" "}
            {partSuggestion.reason}
          </p>
          <p className="mt-2 text-[11px] text-orange-800 dark:text-orange-200">
            Only request a replacement if the transcript supports it. Confirm
            symptoms before adding to Part Request.
          </p>
        </article>
      )}

      {relevance.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase text-slate-500">
            Related knowledge items
          </p>
          <ul className="mt-1.5 space-y-1.5 text-xs">
            {relevance.map(({ item, reasons }) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900/60"
              >
                <span className="font-medium text-slate-800 dark:text-slate-100">{item.title}</span>
                <span className="badge-neutral !py-0 !text-[10px]">
                  {labelForKnowledgeType(item.type)}
                </span>
                {reasons.length > 0 && (
                  <span className="text-slate-500 dark:text-slate-500">
                    {reasons.slice(0, 2).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
