import { useMemo, useState } from "react";
import { useAppStore } from "../services/appStore";
import {
  getRelatedTickets,
  suggestSolutionsForCurrent,
  type SimilarSuggestion,
} from "../services/ticketIntelligence";
import { CopyButton } from "./CopyButton";
import { AddToKnowledgeButton } from "./AddToKnowledgeButton";
import { formatDateTime } from "../utils/formatDate";

/**
 * Phase 5 panel that lives on the Ticket Form Helper page. Reads the current
 * ExtractedDetails + transcript from the app store, runs the intelligence
 * suggestion engine, and renders the top suggestion with the supporting
 * evidence (similar count, related subjects, common missing fields, etc.).
 *
 * Buttons follow the spec exactly:
 *   • Copy Suggested Solution      — clipboard copy via CopyButton
 *   • Add to Resolution            — appends the suggestion text to the
 *     editable resolution field; never overwrites existing content
 *   • View Related Tickets         — expands an inline list of the top
 *     related tickets (subject/store/date/resolution/feedback). Inline
 *     because History does not currently support deep-link by ID.
 *   • Dismiss Suggestion           — hides the panel for the rest of the
 *     session. Resets the next time the page is reloaded.
 *
 * Empty state: "No similar past tickets found yet." per spec.
 */
export function SuggestedSolutionsPanel() {
  const details = useAppStore((s) => s.details);
  const transcript = useAppStore((s) => s.transcript);
  const fields = useAppStore((s) => s.ticketFields);
  const patch = useAppStore((s) => s.patchTicketFields);
  const setStatus = useAppStore((s) => s.setStatus);

  const [dismissed, setDismissed] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const suggestions: SimilarSuggestion[] = useMemo(() => {
    const haveSeed = !!(
      details.category ||
      details.deviceType ||
      details.issue ||
      details.errorMessage ||
      transcript.trim()
    );
    if (!haveSeed) return [];
    try {
      return suggestSolutionsForCurrent({ details, transcript });
    } catch {
      return [];
    }
  }, [details, transcript]);

  if (dismissed) return null;

  const haveSeed = !!(
    details.category ||
    details.deviceType ||
    details.issue ||
    details.errorMessage ||
    transcript.trim()
  );
  if (!haveSeed) return null;

  const top = suggestions[0];

  function handleAddToResolution(suggestion: string): void {
    const existing = fields.resolution.trim();
    const block = `Suggested based on past tickets: ${suggestion}\n(Verify before applying.)`;
    const next = existing ? `${existing}\n\n${block}` : block;
    patch({ resolution: next });
    setStatus({
      kind: "info",
      message: "Suggested solution appended to Resolution. Edit before saving.",
    });
  }

  function handleDismiss(): void {
    setDismissed(true);
    setStatus({
      kind: "info",
      message: "Suggestion dismissed for this session. Refresh the page to see it again.",
    });
  }

  return (
    <section className="card space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Suggested Solutions</h2>
          <p className="text-xs text-slate-500">
            Suggested based on similar previous tickets. Verify before applying.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={handleDismiss}
          title="Hide this panel for the rest of the session."
        >
          Dismiss
        </button>
      </header>

      {suggestions.length === 0 || !top ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No similar past tickets found yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s, idx) => {
            const isExpanded = expandedIdx === idx;
            return (
              <li
                key={idx}
                className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <ConfidencePill c={s.confidence} />
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                    {s.basedOnCount} similar ticket{s.basedOnCount === 1 ? "" : "s"}
                  </span>
                  {s.workedCount > 0 && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                      ✓ {s.workedCount} worked
                    </span>
                  )}
                  {s.didNotWorkCount > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                      ✗ {s.didNotWorkCount} did not work
                    </span>
                  )}
                  {s.escalationRatio >= 0.5 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      ⚠ Often escalated
                    </span>
                  )}
                  {s.partRequestRatio >= 0.5 && (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
                      ⚠ Often needs replacement parts
                    </span>
                  )}
                </div>

                <p className="mt-2 text-slate-700 dark:text-slate-200">{s.suggestion}</p>

                {s.commonMissingDetails.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    Common details to verify:{" "}
                    {s.commonMissingDetails.join(", ")}
                  </p>
                )}

                {s.warning && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">
                    ⚠ {s.warning}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <CopyButton
                    text={s.suggestion}
                    label="Copy Suggested Solution"
                    className="btn-secondary text-xs"
                  />
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => handleAddToResolution(s.suggestion)}
                    title="Append the suggested solution to the editable Resolution field. Existing content is preserved."
                  >
                    Add to Resolution
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    disabled={s.relatedTicketIds.length === 0}
                    title={
                      s.relatedTicketIds.length === 0
                        ? "No related tickets recorded for this pattern."
                        : isExpanded
                          ? "Hide the related ticket list."
                          : "Show the related saved tickets this suggestion is based on."
                    }
                  >
                    {isExpanded
                      ? "Hide Related Tickets"
                      : `View Related Tickets (${s.relatedTicketIds.length})`}
                  </button>
                  <AddToKnowledgeButton
                    className="btn-ghost text-xs"
                    defaultType="common_problem"
                    label="Add to Knowledge Base"
                  />
                </div>

                {isExpanded && <RelatedTicketsList ids={s.relatedTicketIds} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ConfidencePill({ c }: { c: SimilarSuggestion["confidence"] }) {
  const tone =
    c === "High"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : c === "Medium"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
        : "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {c} confidence
    </span>
  );
}

function RelatedTicketsList({ ids }: { ids: string[] }) {
  // ticketStore is hydrated synchronously by initStorage. The lookup is cheap,
  // so we do it on every expansion rather than caching.
  const tickets = useMemo(() => getRelatedTickets(ids), [ids]);
  if (tickets.length === 0) {
    return (
      <p className="mt-3 text-xs text-slate-500">
        Related tickets are no longer in the local history.
      </p>
    );
  }
  return (
    <div className="mt-3 overflow-hidden rounded border border-slate-200 dark:border-slate-700">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 dark:bg-slate-900/60">
          <tr>
            <th className="px-2 py-1 font-medium">Subject</th>
            <th className="px-2 py-1 font-medium">Store</th>
            <th className="px-2 py-1 font-medium">Date</th>
            <th className="px-2 py-1 font-medium">Result</th>
            <th className="px-2 py-1 font-medium">Part?</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr
              key={t.id}
              className="border-t border-slate-200 align-top dark:border-slate-700"
            >
              <td className="px-2 py-1">
                <div className="font-medium">{t.ticketFields?.subject || "(no subject)"}</div>
                {t.ticketFields?.resolution && (
                  <div className="mt-1 max-w-md truncate text-slate-500">
                    {t.ticketFields.resolution}
                  </div>
                )}
              </td>
              <td className="px-2 py-1">{t.details.storeNumber || "—"}</td>
              <td className="px-2 py-1 whitespace-nowrap">
                {formatDateTime(t.createdAt)}
              </td>
              <td className="px-2 py-1">{t.details.result || "—"}</td>
              <td className="px-2 py-1">{t.details.partNeeded ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
