import type { SummaryVariant } from "../types/ticket";
import { SUMMARY_VARIANTS } from "../types/ticket";

interface Props {
  value: SummaryVariant;
  onChange: (v: SummaryVariant) => void;
  disabled?: boolean;
}

export function SummaryVersionSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-1">
      {SUMMARY_VARIANTS.map((variant) => {
        const active = variant.value === value;
        return (
          <button
            key={variant.value}
            type="button"
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              active
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            }`}
            onClick={() => onChange(variant.value)}
            disabled={disabled}
            title={variant.hint}
          >
            {variant.label}
          </button>
        );
      })}
    </div>
  );
}
