import { DETAIL_LEVELS, type DetailLevel } from "../types/ticket";

export function DetailLevelSelector({
  value,
  onChange,
  disabled,
}: {
  value: DetailLevel;
  onChange: (v: DetailLevel) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DETAIL_LEVELS.map((level) => {
        const active = level.value === value;
        return (
          <button
            key={level.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(level.value)}
            className={`rounded-md border px-3 py-2 text-left text-sm transition ${
              active
                ? "border-brand-500 bg-brand-600 text-white"
                : "border-slate-300 bg-white hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
            }`}
          >
            <div className="font-medium">{level.label}</div>
            <div className="text-[11px] opacity-75">{level.hint}</div>
          </button>
        );
      })}
    </div>
  );
}
