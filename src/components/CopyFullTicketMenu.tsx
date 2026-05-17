import { useState } from "react";
import { useAppStore } from "../services/appStore";
import { copyText } from "../services/clipboardService";
import { COPY_FORMATS, formatTicket, type CopyFormat } from "../services/copyFormats";

/**
 * Phase 9: dropdown menu for "Copy Full Ticket" with multiple formats.
 *
 * Replaces the single-action button on Ticket Form Helper. The default
 * action (clicking the main button without opening the dropdown) is the
 * existing full-ticket format, so muscle-memory clicks still produce the
 * same paste they always did.
 */
export function CopyFullTicketMenu({ className }: { className?: string }) {
  const fields = useAppStore((s) => s.ticketFields);
  const mapping = useAppStore((s) => s.settings.fieldMapping);
  const setStatus = useAppStore((s) => s.setStatus);
  const [open, setOpen] = useState(false);
  const [lastFormat, setLastFormat] = useState<CopyFormat>("default");

  async function copyFormat(format: CopyFormat) {
    setOpen(false);
    setLastFormat(format);
    const text = formatTicket(fields, format, mapping);
    if (!text.trim()) {
      setStatus({ kind: "warning", message: "Nothing to copy in this format." });
      return;
    }
    try {
      await copyText(text);
      const label =
        COPY_FORMATS.find((f) => f.value === format)?.label ?? format;
      setStatus({ kind: "success", message: `Copied: ${label}` });
    } catch (e) {
      setStatus({ kind: "error", message: `Copy failed: ${(e as Error).message}` });
    }
  }

  const cls = className ?? "btn-primary";

  return (
    <span className="relative inline-block">
      <span className="inline-flex">
        <button
          type="button"
          className={`${cls} rounded-r-none`}
          onClick={() => copyFormat(lastFormat)}
          title={`Copy using last format: ${COPY_FORMATS.find((f) => f.value === lastFormat)?.label}`}
        >
          Copy Full Ticket
        </button>
        <button
          type="button"
          className={`${cls} -ml-px rounded-l-none px-2`}
          onClick={() => setOpen((v) => !v)}
          title="Choose a format"
          aria-label="Choose copy format"
        >
          ▾
        </button>
      </span>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 w-72 rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          role="menu"
        >
          {COPY_FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 ${
                f.value === lastFormat ? "bg-slate-50 dark:bg-slate-800/60" : ""
              }`}
              onClick={() => copyFormat(f.value)}
              role="menuitem"
              title={f.hint}
            >
              <span className="font-medium">{f.label}</span>
              <span className="ml-1 text-slate-500">— {f.hint}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
