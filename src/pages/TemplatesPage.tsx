import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CopyButton } from "../components/CopyButton";
import { Icon } from "../components/Icon";

interface TemplateDef {
  name: string;
  text: string;
  category: "Outcome" | "Issue type";
}

const TEMPLATES: TemplateDef[] = [
  {
    category: "Outcome",
    name: "Resolved",
    text: "Store {storeNumber} called regarding {issue}. {steps}. {resolution}",
  },
  {
    category: "Outcome",
    name: "Pending",
    text: "Store {storeNumber} called regarding {issue}. {steps}. Result not confirmed.",
  },
  {
    category: "Outcome",
    name: "Escalated",
    text: "Store {storeNumber} called regarding {issue}. {steps}. Issue was escalated for further review.",
  },
  {
    category: "Issue type",
    name: "Return / Exchange Issue",
    text: "Store {storeNumber} called regarding a {typeOfTransaction} issue. Transaction number {transactionNumber}, item number {itemNumber}. {steps}. {resolution}",
  },
  {
    category: "Issue type",
    name: "VeriFone / Pin Pad",
    text: "Store {storeNumber} reported a VeriFone issue on register {registerNumber}. {steps}. {resolution}",
  },
  {
    category: "Issue type",
    name: "Internet / Inseego",
    text: "Store {storeNumber} reported internet instability. {steps}. {resolution}",
  },
];

const VARIABLES = [
  "storeNumber",
  "registerNumber",
  "dateTimeOfIssue",
  "contactName",
  "requesterName",
  "category",
  "subCategory",
  "item",
  "transactionNumber",
  "itemNumber",
  "typeOfTransaction",
  "paymentType",
  "issue",
  "errorMessage",
  "steps",
  "resolution",
  "additionalComments",
  "technician",
] as const;

export function TemplatesPage() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | TemplateDef["category"]>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATES.filter((t) => {
      if (activeCategory !== "all" && t.category !== activeCategory) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) || t.text.toLowerCase().includes(q)
      );
    });
  }, [query, activeCategory]);

  const grouped = useMemo(() => {
    const map = new Map<TemplateDef["category"], TemplateDef[]>();
    for (const t of filtered) {
      const arr = map.get(t.category) ?? [];
      arr.push(t);
      map.set(t.category, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Templates</h1>
          <p className="page-subtitle">
            Reference patterns that the rule-based ticket generator follows.
            Use them as quick wording for ad-hoc tickets, or open{" "}
            <Link className="text-brand-700 underline-offset-2 hover:underline dark:text-brand-300" to="/style-examples">
              Style Examples
            </Link>{" "}
            to teach the AI your own writing voice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="search" className="h-3.5 w-3.5" />
            </span>
            <input
              className="input h-9 w-56 pl-8"
              placeholder="Search templates"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {(["all", "Outcome", "Issue type"] as const).map((c) => {
          const active = activeCategory === c;
          return (
            <button
              key={c}
              type="button"
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600"
              }`}
              onClick={() => setActiveCategory(c)}
            >
              {c === "all" ? "All" : c}
            </button>
          );
        })}
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/40 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
          No templates match <span className="font-mono">{query || "your filter"}</span>.
        </div>
      ) : (
        grouped.map(([category, list]) => (
          <section key={category} className="space-y-2">
            <h2 className="page-section">{category}</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {list.map((t) => (
                <article
                  key={t.name}
                  className="card group flex flex-col gap-2 transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {t.name}
                    </h3>
                    <CopyButton text={t.text} label="Copy" className="btn-ghost h-7 px-2 text-xs" />
                  </div>
                  <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 font-mono text-xs leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                    {t.text}
                  </pre>
                </article>
              ))}
            </div>
          </section>
        ))
      )}

      <section className="card">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          Available variables
        </h2>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          The generator fills these from the Extracted Details + Form Helper fields. Variables not
          present in a ticket are skipped, so a template never emits empty placeholders.
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {VARIABLES.map((v) => (
            <li
              key={v}
              className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
            >
              {`{${v}}`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
