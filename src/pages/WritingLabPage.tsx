import { useMemo, useState } from "react";
import { CopyButton } from "../components/CopyButton";
import { Icon } from "../components/Icon";
import { EMPTY_DETAILS, type ExtractedDetails } from "../types/ticket";
import { DEFAULT_WRITING_STYLE } from "../types/settings";
import { generateTicket } from "../services/ticketGenerator";
import {
  buildDescription,
  buildPartRequest,
  buildResolution,
  buildSubject,
  buildFullTicketText,
  generateTicketFields,
} from "../services/ticketFieldGenerator";
import {
  FORBIDDEN_PHRASES,
  RESULT_GATED_FORBIDDEN_PHRASES,
  WRITING_QUALITY_CHECKLIST,
  WRITING_RULES,
} from "../services/writingRules";

/**
 * Phase 10D — Writing Lab.
 *
 * A QA / regression-debugging surface that takes structured ExtractedDetails
 * input and previews every text field the app emits — without needing a live
 * call recording. Useful for:
 *   - reproducing a bad ticket output by pasting the captured details JSON;
 *   - tweaking the JSON to find the input shape that triggers the bug;
 *   - copying the result as a structured test case for the golden suite;
 *   - doing a manual writing-quality pass against the rule cards / checklist.
 *
 * The forbidden-phrase scanner runs in real time on every output. Hits are
 * surfaced in the red "Issues detected" banner so a reviewer can spot
 * regressions without leaving the page.
 */

interface PresetExample {
  id: string;
  name: string;
  details: Partial<ExtractedDetails>;
}

const PRESET_EXAMPLES: PresetExample[] = [
  {
    id: "berry-523",
    name: "Berry / Store 523 — credit card machine issue",
    details: {
      callerName: "Berry",
      storeNumber: "523",
      issue: "Credit card machine issue",
      steps: [
        "escaped out of the transaction",
        "re-entered the transaction from the beginning",
        "advised store to wait one second between key presses",
      ],
      result: "Resolved",
    },
  },
  {
    id: "store-521-keyboard",
    name: "Store 521 — Register 2 keyboard power drain",
    details: {
      storeNumber: "521",
      registerNumber: "2",
      issue: "keyboard issue",
      deviceType: "keyboard",
      powerDrainPerformed: true,
      cablesReseated: true,
      confirmationMethod: "Keyboard confirmed working",
      result: "Resolved",
    },
  },
  {
    id: "store-1378-printer",
    name: "Store 1378 — Register 3 receipt printer hardware failure",
    details: {
      storeNumber: "1378",
      registerNumber: "3",
      issue: "receipt printer hardware failure",
      deviceType: "receipt printer",
      errorMessage: "hardware failure",
      partNeeded: true,
      parts: ["receipt printer"],
      replacementReason: "hardware failure persisted after troubleshooting",
      result: "PartsNeeded",
    },
  },
  {
    id: "store-657-store-closed",
    name: "Store 657 — store closed after start of day",
    details: {
      storeNumber: "657",
      issue: 'the registers were displaying "store closed" after start of day',
      cacheRenamed: true,
      affectedRegisters: ["both registers"],
      confirmationMethod: "Both registers back online",
      result: "Resolved",
    },
  },
  {
    id: "store-395-internet",
    name: "Store 395 — internet down / Inseego restart",
    details: {
      storeNumber: "395",
      issue: "internet down",
      devices: ["Inseego"],
      manualRebootPerformed: true,
      confirmationMethod: "Connection restored",
      result: "Resolved",
    },
  },
  {
    id: "store-118-bos",
    name: "Store 118 — BOS stuck while adding employee",
    details: {
      storeNumber: "118",
      issue: "BOS stuck while adding a new employee",
      systems: ["BOS"],
      employeeName: "Jane Doe",
      steps: ["had the manager log out and back in", "cleared browser cache"],
      result: "Pending",
    },
  },
];

function fillDetails(over: Partial<ExtractedDetails>): ExtractedDetails {
  return { ...EMPTY_DETAILS, ...over };
}

interface ForbiddenHit {
  field: string;
  rule: string;
  pattern: string;
  text: string;
}

function scanForbidden(d: ExtractedDetails, outputs: Array<[string, string]>): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  for (const [field, text] of outputs) {
    if (!text) continue;
    for (const { pattern, description } of FORBIDDEN_PHRASES) {
      if (pattern.test(text)) {
        hits.push({ field, rule: description, pattern: String(pattern), text });
      }
    }
    for (const { pattern, description, appliesWhen } of RESULT_GATED_FORBIDDEN_PHRASES) {
      if (
        appliesWhen({ result: d.result, partNeeded: d.partNeeded }) &&
        pattern.test(text)
      ) {
        hits.push({ field, rule: description, pattern: String(pattern), text });
      }
    }
  }
  return hits;
}

export function WritingLabPage() {
  const [jsonInput, setJsonInput] = useState<string>(
    JSON.stringify(PRESET_EXAMPLES[0].details, null, 2),
  );
  const [activePreset, setActivePreset] = useState<string>(PRESET_EXAMPLES[0].id);
  const [showRules, setShowRules] = useState(false);
  const [showChecklist, setShowChecklist] = useState(true);

  const parsed = useMemo<{
    ok: boolean;
    error: string | null;
    details: ExtractedDetails;
  }>(() => {
    try {
      const raw = JSON.parse(jsonInput) as Partial<ExtractedDetails>;
      return { ok: true, error: null, details: fillDetails(raw) };
    } catch (e) {
      return { ok: false, error: (e as Error).message, details: fillDetails({}) };
    }
  }, [jsonInput]);

  const outputs = useMemo(() => {
    const d = parsed.details;
    const passive = { ...DEFAULT_WRITING_STYLE, voice: "passive" as const };
    const fields = generateTicketFields({ details: d, writingStyle: passive });
    const subject = buildSubject(d);
    const description = buildDescription(d, passive);
    const resolution = buildResolution(d, DEFAULT_WRITING_STYLE);
    const partRequest = buildPartRequest(d);
    const short = generateTicket({ detailLevel: "Short", details: d });
    const normal = generateTicket({ detailLevel: "Normal", details: d });
    const detailed = generateTicket({ detailLevel: "Detailed", details: d });
    const technical = generateTicket({ detailLevel: "Technical", details: d });
    const management = generateTicket({ detailLevel: "ManagementSummary", details: d });
    const fullTicket = buildFullTicketText(fields);
    return {
      subject,
      description,
      resolution,
      partRequest,
      short,
      normal,
      detailed,
      technical,
      management,
      fullTicket,
    };
  }, [parsed]);

  const forbiddenHits = useMemo(() => {
    if (!parsed.ok) return [];
    const tuples: Array<[string, string]> = [
      ["subject", outputs.subject],
      ["description", outputs.description],
      ["resolution", outputs.resolution],
      ["partRequest", outputs.partRequest],
      ["short", outputs.short],
      ["normal", outputs.normal],
      ["detailed", outputs.detailed],
      ["technical", outputs.technical],
      ["management", outputs.management],
    ];
    return scanForbidden(parsed.details, tuples);
  }, [parsed, outputs]);

  function loadPreset(p: PresetExample) {
    setActivePreset(p.id);
    setJsonInput(JSON.stringify(p.details, null, 2));
  }

  const testCaseJson = useMemo(() => {
    if (!parsed.ok) return "";
    const cleanedDetails = JSON.parse(jsonInput) as Partial<ExtractedDetails>;
    return JSON.stringify(
      {
        name: "TODO: name this test case",
        input: cleanedDetails,
        expected: {
          subject: outputs.subject,
          description: outputs.description,
          resolution: outputs.resolution,
          partRequest: outputs.partRequest,
          short: outputs.short,
          normal: outputs.normal,
          detailed: outputs.detailed,
          technical: outputs.technical,
          management: outputs.management,
        },
      },
      null,
      2,
    );
  }, [parsed, jsonInput, outputs]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Writing Lab</h1>
          <p className="page-subtitle">
            Paste extracted details JSON and preview every ticket field — without recording a call.
            Forbidden-phrase scan runs live so you spot regressions immediately.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowRules((v) => !v)}
            aria-expanded={showRules}
          >
            <Icon name="book" className="h-4 w-4" />
            <span>{showRules ? "Hide rules" : "Show rules"}</span>
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowChecklist((v) => !v)}
            aria-expanded={showChecklist}
          >
            <Icon name="list" className="h-4 w-4" />
            <span>{showChecklist ? "Hide checklist" : "Show checklist"}</span>
          </button>
        </div>
      </header>

      {showRules && (
        <section className="card space-y-3">
          <h2 className="text-base font-semibold">Writing Style Rules</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {WRITING_RULES.map((r) => (
              <li
                key={r.rule}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50"
              >
                <div className="font-semibold leading-tight">{r.rule}</div>
                <div className="mt-1 text-slate-600 dark:text-slate-400">{r.reason}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showChecklist && (
        <section className="card space-y-2">
          <h2 className="text-base font-semibold">Writing Quality Checklist</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Walk through this every time you ship a generator change. If you can answer "yes" to
            all ten, the ticket reads like a real technician wrote it.
          </p>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {WRITING_QUALITY_CHECKLIST.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded border border-slate-300 dark:border-slate-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Preset examples</h2>
          <span className="text-xs text-slate-500">
            Click one to load it into the editor below.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESET_EXAMPLES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadPreset(p)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                activePreset === p.id
                  ? "border-brand-600 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-900/30 dark:text-brand-100"
                  : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800/60"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Extracted Details (JSON)</h2>
            <span
              className={`text-xs ${
                parsed.ok ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {parsed.ok ? "valid" : "invalid JSON"}
            </span>
          </div>
          <textarea
            spellCheck={false}
            className="h-[420px] w-full resize-none rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            value={jsonInput}
            onChange={(ev) => setJsonInput(ev.target.value)}
          />
          {!parsed.ok && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-300">
              {parsed.error}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <CopyButton
              text={testCaseJson}
              label="Copy Test Case JSON"
              className="btn-secondary"
            />
            <CopyButton text={outputs.fullTicket} label="Copy Full Ticket" />
          </div>
        </section>

        <section className="space-y-3">
          {forbiddenHits.length > 0 && (
            <div className="card border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700/60 dark:bg-rose-900/20 dark:text-rose-100">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="shield" className="h-4 w-4" />
                Issues detected ({forbiddenHits.length})
              </div>
              <ul className="mt-2 space-y-1.5 text-xs">
                {forbiddenHits.map((h, i) => (
                  <li key={i} className="border-l-2 border-rose-400 pl-2">
                    <span className="font-mono">{h.field}</span> — {h.rule}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <OutputCard label="Subject" value={outputs.subject} />
          <OutputCard label="Description" value={outputs.description} />
          <OutputCard label="Resolution" value={outputs.resolution} />
          {outputs.partRequest && (
            <OutputCard label="Part Request" value={outputs.partRequest} />
          )}
          <OutputCard label="Short" value={outputs.short} />
          <OutputCard label="Normal" value={outputs.normal} />
          <OutputCard label="Detailed" value={outputs.detailed} />
          <OutputCard label="Technical" value={outputs.technical} />
          <OutputCard label="Management Summary" value={outputs.management} />
        </section>
      </div>
    </div>
  );
}

function OutputCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <CopyButton text={value} label="Copy" className="btn-ghost text-xs" />
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
        {value || <span className="italic text-slate-500">(empty)</span>}
      </p>
    </div>
  );
}
