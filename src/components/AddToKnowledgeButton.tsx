import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { KNOWLEDGE_TYPES, type KnowledgeItemType } from "../types/knowledge";

/**
 * Reusable "Add to Knowledge Base" button. Opens an inline type picker (the
 * 8 KnowledgeItemTypes), then calls `createKnowledgeFromTicket` to prefill
 * a draft and navigates to /knowledge?prefill=<type>&ticketId=<id> so the
 * KB page opens directly into the editor.
 *
 * Two modes:
 *   • `ticketId` provided → captures from that saved ticket.
 *   • no `ticketId`       → captures from the current workflow ticket
 *     (saving it first if it has unsaved content).
 *
 * Buttons render disabled with a `title` reason rather than silently
 * no-oping when there's nothing to capture, per the project's "no fake
 * buttons" rule.
 */
export function AddToKnowledgeButton({
  ticketId,
  className,
  disabledReason,
  defaultType = "troubleshooting_guide",
  label = "Add to Knowledge Base",
  /** When true, render a single button that immediately creates a KB row of `defaultType`. */
  oneClick = false,
}: {
  ticketId?: string;
  className?: string;
  disabledReason?: string;
  defaultType?: KnowledgeItemType;
  label?: string;
  oneClick?: boolean;
}) {
  const navigate = useNavigate();
  const createFromTicket = useAppStore((s) => s.createKnowledgeFromTicket);
  const [open, setOpen] = useState(false);

  const cls = className ?? "btn-secondary text-xs";

  if (disabledReason) {
    return (
      <button type="button" className={cls} disabled title={disabledReason}>
        {label}
      </button>
    );
  }

  function captureWithType(type: KnowledgeItemType) {
    const item = createFromTicket({ type, ticketId });
    setOpen(false);
    if (item) {
      // Re-route through the KB page so the new draft is editable.
      navigate(`/knowledge?prefill=${type}&ticketId=${ticketId ?? ""}`);
    }
  }

  if (oneClick) {
    return (
      <button
        type="button"
        className={cls}
        onClick={() => captureWithType(defaultType)}
        title="Capture this ticket into a knowledge item and open it for editing."
      >
        {label}
      </button>
    );
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className={cls}
        onClick={() => setOpen((v) => !v)}
        title="Pick a knowledge item type — common problem, troubleshooting guide, part request rule, etc."
      >
        {label}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="px-1 pb-1 text-[11px] uppercase tracking-wide text-slate-500">
            Capture as…
          </p>
          {KNOWLEDGE_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => captureWithType(t.value)}
              title={t.hint}
            >
              <span className="font-medium">{t.label}</span>
              <span className="ml-1 text-slate-500">— {t.hint}</span>
            </button>
          ))}
          <button
            type="button"
            className="mt-1 block w-full rounded px-2 py-1 text-left text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </span>
  );
}
