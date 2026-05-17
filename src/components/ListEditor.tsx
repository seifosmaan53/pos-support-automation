import { useState } from "react";

export function ListEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange([...values, v]);
    setDraft("");
  }

  return (
    <div>
      <label className="label mb-1">{label}</label>
      {values.length > 0 && (
        <ul className="mb-2 space-y-1">
          {values.map((v, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <input
                value={v}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="flex-1 bg-transparent outline-none"
              />
              <button
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="ml-2 text-xs text-red-500 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn-secondary" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}
