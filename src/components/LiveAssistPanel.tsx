import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../services/appStore";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { analyzeTranscript } from "../services/transcriptAnalyzer";
import { suggestQuestions } from "../services/ticketKnowledge";
import { isNearEndOfCall, liveAskNextQuestions, rankAndCapQuestions } from "../services/liveAskNext";
import { findSourceForValue, formatSourceLabel } from "../services/liveDetailProvenance";
import {
  guidedTroubleshootingSteps,
  knowledgeDrivenQuestions,
  partRequestSuggestion,
  relevantKnowledgeForCurrent,
} from "../services/knowledgeIntelligence";
import { suggestSolutionsForCurrent } from "../services/ticketIntelligence";
import { resultLabel } from "../utils/resultWording";
import { labelForKnowledgeType } from "../types/knowledge";
import {
  TICKET_RESULTS,
  type ExtractedDetails,
  type TicketResult,
} from "../types/ticket";
import type { LiveAssistAnswerKind, LiveAssistAnswers } from "../types/liveAssist";
import { extractionPatternsStore } from "../services/extractionPatternsStore";
import { assessTranscriptQuality } from "../services/transcriptQuality";
import { Icon } from "./Icon";

/**
 * Phase 8 Live Call Assist.
 *
 * Listens to the live transcript, runs the *rule-based* analyzer on a
 * debounced cadence, and surfaces:
 *   • detected detail cards with confidence labels (no false certainty)
 *   • missing detail alerts ("Ask for register number")
 *   • ask-next suggested questions (rule-based + knowledge-driven)
 *   • guided troubleshooting steps (stored KB + built-ins, marked Suggested)
 *   • suggested solutions from saved tickets
 *   • relevant Knowledge Base items
 *
 * Critical safety rules:
 *   • Steps are *suggested only* — they never get marked as completed in
 *     the ticket unless the transcript confirms they were done.
 *   • Confidence labels (High / Medium / Low / Review needed / Not
 *     confirmed) gate every detected value so the panel never claims
 *     certainty it doesn't have.
 *   • The panel uses `analyzeTranscript()` — the pure rule-based extractor
 *     — not `analyzeWithAI()`. No network calls, no waiting on Ollama,
 *     so the live preview stays responsive.
 *   • Live Assist is a *preview*. The Analyze button still triggers the
 *     final extraction → speaker detection → guided steps → final fields
 *     pipeline, which is what the saved ticket reflects.
 */

type Confidence = "High" | "Medium" | "Low" | "Review needed" | "Not confirmed";

interface DetectedCard {
  label: string;
  value: string;
  confidence: Confidence;
  hint?: string;
  /** Underlying answer kind (if any) — drives the inline edit + clear buttons. */
  answerKind?: LiveAssistAnswerKind;
  /** Source-segment label like "Caller at 00:12" when we can find one. */
  sourceLabel?: string;
}

export function LiveAssistPanel() {
  // Phase 11A: when a live chunked capture is producing transcript text in
  // real time, prefer that over the (likely empty) saved `transcript` field.
  // After Stop, the user picks Live or Final in the review card; the chosen
  // text gets written into `transcript` and live is cleared, so this OR
  // resolves the right way at every phase.
  const transcript = useAppStore((s) =>
    s.liveCapture.liveTranscript && s.liveCapture.status === "capturing"
      ? s.liveCapture.liveTranscript
      : s.transcript,
  );
  const isLiveCapture = useAppStore((s) => s.liveCapture.status === "capturing");
  const extractionVersion = useAppStore((s) => s.liveCapture.extractionVersion);
  const liveCallerName = useAppStore((s) => s.liveCapture.detectedCallerName);
  const liveSegments = useAppStore((s) => s.liveCapture.segments);
  const settings = useAppStore((s) => s.settings);
  const liveAssistAnswers = useAppStore((s) => s.liveAssistAnswers);
  const setLiveAssistAnswer = useAppStore((s) => s.setLiveAssistAnswer);
  // Debounce so a paste-burst of transcript text is coalesced into one
  // re-render. 250ms is invisible-feeling but kills the per-keystroke churn.
  const debounced = useDebouncedValue(transcript, 250);

  const analysis = useMemo(() => {
    if (!debounced.trim()) return null;
    try {
      // Phase 10B+C — feed user / learned patterns into the live preview
      // too so the panel's sensitivity matches what Analyze will produce.
      return analyzeTranscript(debounced, {
        correctionDictionary: settings.correctionDictionary,
        enableTranscriptCorrection: settings.enableTranscriptCorrection !== false,
        enableNumberWordNormalization:
          settings.enableNumberWordNormalization !== false,
        customPatterns: extractionPatternsStore.active(),
        onPatternHit: (id) => extractionPatternsStore.recordHit(id),
      });
    } catch {
      return null;
    }
    // liveAssistAnswers in the dep list so the preview re-runs when the user
    // edits / clears an answer (the "Your answers" chips change shape).
    // extractionVersion lets the Final Review "Re-run Extraction" button force
    // a refresh even when no transcript text changed (e.g. after relabeling).
  }, [debounced, settings.correctionDictionary, settings.enableTranscriptCorrection, settings.enableNumberWordNormalization, liveAssistAnswers, extractionVersion]);

  if (!debounced.trim()) {
    return (
      <section className="card space-y-1 border-sky-200 dark:border-sky-800/70">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            <Icon name="sparkle" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Live Assist</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Start recording or paste a transcript above. As text comes in, this
              panel will show detected details, missing info, suggested questions,
              and troubleshooting guidance — all updated in near real time.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!analysis) return null;

  // Phase 16C — transcript-quality gate. If the verdict says the transcript
  // isn't good enough, we hide the detected-detail cards + KB matches +
  // device-specific prompts. The header still renders so the user knows
  // Live Assist exists; ask-next falls back to generic intake.
  const verdict = assessTranscriptQuality(debounced);
  const gateBlocksLiveAssist = !verdict.shouldShowLiveAssist;
  const gateBlocksKnowledge = !verdict.shouldShowKnowledge;
  const gateBlocksDeviceSpecific = !verdict.shouldShowDeviceSpecificPrompts;

  const cards = gateBlocksLiveAssist
    ? []
    : buildDetectedCards(analysis, liveAssistAnswers, liveSegments);
  const missing = gateBlocksLiveAssist
    ? []
    : buildMissingAlerts(analysis, liveAssistAnswers);
  const ruleQuestions = safeSuggestQuestions(analysis);
  const kbQuestions = gateBlocksKnowledge
    ? []
    : safeKnowledgeQuestions(analysis, debounced);
  // Domain-tailored playbook: keyboard / printer / internet / pin pad / scanner
  // probes plus the universal "is this resolved" closer. Merged in after the
  // rule-based questions so generic intake gaps still appear first.
  const haveCallerName = !!(liveCallerName || liveAssistAnswers.callerName || analysis.callerName);
  const domainQuestions = gateBlocksDeviceSpecific
    ? []
    : liveAskNextQuestions({
        details: analysis,
        transcript: debounced,
        haveCallerName,
      });
  const askNextRaw = mergeQuestions(
    mergeQuestions(ruleQuestions, kbQuestions),
    domainQuestions,
  );
  // Phase 11B: rank by urgency, cap to 5. When the call is closing (steps
  // taken but no result yet) result-confirmation jumps to the top.
  const askNext = rankAndCapQuestions(
    askNextRaw,
    {
      details: analysis,
      haveCallerName,
      nearEndOfCall: isNearEndOfCall(analysis),
    },
    5,
  );
  const guidedGroups = gateBlocksDeviceSpecific
    ? []
    : safeGuidedSteps(analysis, debounced);
  const partSuggestion = gateBlocksLiveAssist
    ? null
    : safePartSuggestion(analysis, debounced);
  const solutions = gateBlocksKnowledge ? null : safeSolutions(analysis, debounced);
  const relevant = gateBlocksKnowledge
    ? []
    : dedupeRelevantKnowledge(safeRelevantKnowledge(analysis, debounced));
  const transcriptDoneish = looksDoneish(analysis);

  return (
    <section className="card space-y-3 border-sky-200 dark:border-sky-800/70">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            <Icon name="sparkle" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Live Assist</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Live preview of detected details, missing info, and what to ask
              next. Suggestions only — confirm with the caller before changing
              ticket fields.
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            isLiveCapture
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300"
              : transcriptDoneish
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-300"
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isLiveCapture
                ? "animate-pulse bg-rose-500"
                : transcriptDoneish
                  ? "bg-emerald-500"
                  : "animate-pulse bg-sky-500"
            }`}
          />
          {isLiveCapture ? "Recording · live" : transcriptDoneish ? "Ready to analyze" : "Listening…"}
        </span>
      </header>

      {gateBlocksLiveAssist && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>Transcript quality gate:</strong> {verdict.warning} Live
          Assist is showing generic intake prompts only until the transcript
          looks reliable.
        </div>
      )}

      {/* Detected detail cards */}
      {cards.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <DetectedDetailCard key={c.label} card={c} />
          ))}
        </div>
      )}

      {/* Missing detail alerts — answerable inline */}
      {missing.length > 0 && (
        <SectionCard
          tone="amber"
          icon="alertTriangle"
          title="Missing — ask the caller"
          subtitle="Type the answer right here. It applies to the current ticket immediately and survives re-analysis."
        >
          <ul className="space-y-1.5">
            {missing.map((m) => (
              <MissingAnswerRow
                key={m.kind}
                alert={m}
                onAnswer={(value) => setLiveAssistAnswer(m.kind, value)}
              />
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Show what's already been answered so the user can edit / clear it */}
      {Object.keys(liveAssistAnswers).length > 0 && (
        <SectionCard
          tone="slate"
          icon="check"
          title="Your answers"
          subtitle="Manual values you've added during this call. Click to edit, × to clear."
        >
          <ul className="flex flex-wrap gap-1.5">
            {(Object.entries(liveAssistAnswers) as [LiveAssistAnswerKind, string][]).map(
              ([kind, value]) => (
                <li
                  key={kind}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  <span className="text-[10px] uppercase tracking-wider opacity-70">
                    {ANSWER_LABEL[kind]}
                  </span>
                  <span className="font-semibold">{value}</span>
                  <button
                    type="button"
                    onClick={() => setLiveAssistAnswer(kind, "")}
                    className="rounded-full p-0.5 opacity-60 transition-opacity hover:bg-emerald-100 hover:opacity-100 dark:hover:bg-emerald-900/60"
                    aria-label={`Clear ${ANSWER_LABEL[kind]}`}
                  >
                    <Icon name="x" className="h-3 w-3" />
                  </button>
                </li>
              ),
            )}
          </ul>
        </SectionCard>
      )}

      {/* Ask Next questions */}
      {askNext.length > 0 && (
        <SectionCard tone="slate" icon="info" title="Ask next" subtitle="Suggested follow-up questions.">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {askNext.map((q, i) => (
              <li
                key={q}
                className="flex items-start gap-2 rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200"
              >
                <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-md bg-slate-100 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  {i + 1}
                </span>
                <span className="leading-snug">{q}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Guided Troubleshooting */}
      {guidedGroups.length > 0 && (
        <SectionCard
          tone="slate"
          icon="shield"
          title="Guided troubleshooting"
          subtitle="Suggested only — never written into the ticket. Confirm steps with the caller before marking them done in the ticket."
        >
          <div className="space-y-3">
            {guidedGroups.map((g, idx) => (
              <article
                key={`${g.sourceId || "builtin"}-${idx}`}
                className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60"
              >
                <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {g.title}
                  </h3>
                  <span className={g.sourceId ? "badge-brand" : "badge-neutral"}>
                    {g.sourceId ? "From your KB" : "Built-in"}
                  </span>
                </header>
                {g.steps.length > 0 && (
                  <ul className="space-y-1.5">
                    {g.steps.map((s, i) => {
                      const done = stepLooksConfirmed(s, debounced);
                      return (
                        <li
                          key={i}
                          className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            done
                              ? "border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                              : "border-slate-200/70 bg-slate-50/60 text-slate-700 dark:border-slate-800/70 dark:bg-slate-900/40 dark:text-slate-300"
                          }`}
                        >
                          <span
                            className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border ${
                              done
                                ? "border-emerald-300 bg-emerald-500 text-white"
                                : "border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-900"
                            }`}
                          >
                            {done ? <Icon name="check" className="h-3 w-3" /> : (
                              <span className="text-[10px] font-semibold">{i + 1}</span>
                            )}
                          </span>
                          <div className="flex-1 leading-snug">
                            {!done && (
                              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">
                                Suggested
                              </span>
                            )}
                            <span>{s}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {g.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {g.warnings.map((w, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100"
                      >
                        <Icon name="alertTriangle" className="mt-0.5 h-3.5 w-3.5 flex-none" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Part request suggestion */}
      {partSuggestion && (
        <SectionCard tone="orange" icon="alertTriangle" title="Possible part request">
          <p className="text-sm text-orange-900 dark:text-orange-100">
            <strong className="font-semibold">{partSuggestion.partLabel}</strong> may be needed — {partSuggestion.reason}
          </p>
          <p className="mt-2 text-[11px] text-orange-800 dark:text-orange-200">
            Only request a replacement if the transcript supports it.
          </p>
        </SectionCard>
      )}

      {/* Suggested solutions from past tickets */}
      {solutions && solutions.length > 0 && (
        <SectionCard tone="slate" icon="sparkle" title="From similar past tickets">
          <ul className="space-y-1.5">
            {solutions.slice(0, 3).map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/60"
              >
                <span
                  className={`inline-flex h-5 flex-none items-center gap-1 rounded-full border px-2 text-[10px] font-medium ${
                    s.confidence === "High"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : s.confidence === "Medium"
                        ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-300"
                        : "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {s.confidence}
                </span>
                <div className="flex-1 leading-snug text-slate-700 dark:text-slate-200">
                  {s.suggestion}
                  {s.warning && (
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                      <Icon name="alertTriangle" className="h-3 w-3" />
                      {s.warning}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Relevant KB items */}
      {relevant.length > 0 && (
        <SectionCard tone="slate" icon="shield" title="Relevant Knowledge Base items">
          <ul className="space-y-1.5">
            {relevant.map(({ item }) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/60"
              >
                <Icon name="arrowRight" className="h-3.5 w-3.5 flex-none text-slate-400" />
                <span className="font-medium text-slate-800 dark:text-slate-100">{item.title}</span>
                <span className="badge-neutral !py-0 !text-[10px]">
                  {labelForKnowledgeType(item.type)}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </section>
  );
}

// ── Section card ───────────────────────────────────────────────────────

function SectionCard({
  tone,
  icon,
  title,
  subtitle,
  children,
}: {
  tone: "amber" | "orange" | "slate";
  icon: import("./Icon").IconName;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const palettes = {
    amber: {
      box: "border-amber-200/70 bg-amber-50/60 dark:border-amber-800/50 dark:bg-amber-950/20",
      iconWrap: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200",
      title: "text-amber-900 dark:text-amber-100",
      subtitle: "text-amber-800/80 dark:text-amber-200/80",
    },
    orange: {
      box: "border-orange-200/70 bg-orange-50/60 dark:border-orange-800/50 dark:bg-orange-950/20",
      iconWrap: "bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-200",
      title: "text-orange-900 dark:text-orange-100",
      subtitle: "text-orange-800/80 dark:text-orange-200/80",
    },
    slate: {
      box: "border-slate-200/80 bg-slate-50/40 dark:border-slate-800/70 dark:bg-slate-900/40",
      iconWrap: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
      title: "text-slate-800 dark:text-slate-100",
      subtitle: "text-slate-500 dark:text-slate-400",
    },
  };
  const p = palettes[tone];
  return (
    <section className={`rounded-xl border p-4 ${p.box}`}>
      <header className="mb-3 flex items-start gap-2.5">
        <span className={`mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg ${p.iconWrap}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${p.title}`}>{title}</div>
          {subtitle && <div className={`mt-0.5 text-xs ${p.subtitle}`}>{subtitle}</div>}
        </div>
      </header>
      {children}
    </section>
  );
}

// ── Detected detail card ───────────────────────────────────────────────

function DetectedDetailCard({ card }: { card: DetectedCard }) {
  const empty = !card.value;
  const setLiveAssistAnswer = useAppStore((s) => s.setLiveAssistAnswer);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.value);
  const prevValueRef = useRef(card.value);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Track value transitions so we can show "Updated just now" briefly.
  useEffect(() => {
    if (card.value !== prevValueRef.current) {
      prevValueRef.current = card.value;
      if (card.value.trim()) {
        setUpdatedAt(Date.now());
      }
    }
  }, [card.value]);

  // Auto-hide the "updated just now" badge after a few seconds.
  useEffect(() => {
    if (updatedAt === null) return;
    const t = setTimeout(() => setUpdatedAt(null), 5000);
    return () => clearTimeout(t);
  }, [updatedAt]);

  // Re-seed the inline edit draft from the source of truth (so re-detections
  // are reflected) — but never while the user is mid-edit.
  useEffect(() => {
    if (!editing) setDraft(card.value);
  }, [card.value, editing]);

  const canEdit = !!card.answerKind;

  function commit() {
    if (!card.answerKind) return;
    const cleaned = draft.trim();
    setLiveAssistAnswer(card.answerKind, cleaned);
    setEditing(false);
  }

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        empty
          ? "border-slate-200/70 bg-slate-50/50 dark:border-slate-800/70 dark:bg-slate-900/40"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {card.label}
        </span>
        <div className="inline-flex items-center gap-1.5">
          {updatedAt !== null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-emerald-500" />
              Updated
            </span>
          )}
          <ConfidencePill c={card.confidence} />
        </div>
      </div>
      {editing ? (
        <div className="mt-1.5 space-y-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setDraft(card.value);
                setEditing(false);
              }
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100"
          />
          <div className="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={commit}
              className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-0.5 font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(card.value);
                setEditing(false);
              }}
              className="rounded-md px-2 py-0.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-1.5 flex items-start justify-between gap-2">
            <div className="flex-1 text-sm font-medium leading-snug text-slate-800 dark:text-slate-100">
              {card.value || (
                <span className="text-slate-400 dark:text-slate-500">
                  {card.hint || "Not detected yet"}
                </span>
              )}
            </div>
            {canEdit && (
              <div className="flex flex-none items-center gap-0.5 opacity-60 hover:opacity-100">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(card.value);
                    setEditing(true);
                  }}
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  title={`Edit ${card.label.toLowerCase()}`}
                >
                  <Icon name="doc" className="h-3 w-3" />
                </button>
                {card.value && (
                  <button
                    type="button"
                    onClick={() => setLiveAssistAnswer(card.answerKind!, "")}
                    className="rounded p-0.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    title={`Clear ${card.label.toLowerCase()}`}
                  >
                    <Icon name="x" className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          {card.sourceLabel && card.value && (
            <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
              Source: {card.sourceLabel}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConfidencePill({ c }: { c: Confidence }) {
  const tones: Record<Confidence, { box: string; dot: string }> = {
    High: {
      box: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300",
      dot: "bg-emerald-500",
    },
    Medium: {
      box: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-300",
      dot: "bg-sky-500",
    },
    Low: {
      box: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
      dot: "bg-slate-400",
    },
    "Review needed": {
      box: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300",
      dot: "bg-amber-500",
    },
    "Not confirmed": {
      box: "border-slate-200 bg-slate-100/60 text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400",
      dot: "bg-slate-300 dark:bg-slate-600",
    },
  };
  const t = tones[c];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${t.box}`}
    >
      <span className={`inline-block h-1 w-1 rounded-full ${t.dot}`} />
      {c}
    </span>
  );
}

// ── Build helpers ──────────────────────────────────────────────────────

/** Short label for each kind, used in the "Your answers" chip set. */
const ANSWER_LABEL: Record<LiveAssistAnswerKind, string> = {
  storeNumber: "Store",
  callerName: "Caller",
  registerNumber: "Register",
  errorMessage: "Error",
  result: "Result",
};

function buildDetectedCards(
  d: ExtractedDetails,
  answers: LiveAssistAnswers,
  segments: import("../types/live").LiveSegment[],
): DetectedCard[] {
  const reviewedNames = (d.confidenceNotes ?? []).some((n) =>
    /name|caller|spelling/i.test(n),
  );
  const storeValue = answers.storeNumber || d.storeNumber;
  const callerValue = answers.callerName || d.callerName;
  const registerValue =
    answers.registerNumber ||
    d.registerNumber ||
    (d.affectedRegisters?.length ? d.affectedRegisters.join(", ") : "");
  const errorValue = answers.errorMessage || d.errorMessage;
  const effectiveResult = answers.result || d.result;
  const resultIsConfirmed =
    effectiveResult && effectiveResult !== "ResultNotConfirmed";

  // Helper: derive the source label for a value by scanning live segments.
  // Returns undefined (not "") if the value isn't found — keeps the card
  // from rendering a stale source line.
  const src = (v: string): string | undefined => {
    if (!v.trim()) return undefined;
    const hit = findSourceForValue(v, segments);
    return hit ? formatSourceLabel(hit) : undefined;
  };

  return [
    {
      label: "Store",
      value: storeValue || "",
      confidence: answers.storeNumber
        ? "High"
        : d.storeNumber
          ? "High"
          : "Not confirmed",
      hint: "Ask the caller",
      answerKind: "storeNumber",
      sourceLabel: src(storeValue || ""),
    },
    {
      label: "Caller",
      value: callerValue || "",
      confidence: answers.callerName
        ? "High"
        : d.callerName
          ? reviewedNames
            ? "Review needed"
            : "Medium"
          : "Not confirmed",
      hint: "Ask for first name",
      answerKind: "callerName",
      sourceLabel: src(callerValue || ""),
    },
    {
      label: "Caller role",
      value: d.callerRole || "",
      confidence: d.callerRole ? "Medium" : "Low",
      hint: "Manager / employee?",
      sourceLabel: src(d.callerRole || ""),
    },
    {
      label: "Register",
      value: registerValue,
      confidence: answers.registerNumber
        ? "High"
        : d.registerNumber || d.affectedRegisters?.length
          ? "High"
          : "Not confirmed",
      hint: "Ask which register",
      answerKind: "registerNumber",
      sourceLabel: src(registerValue),
    },
    {
      label: "Device",
      value: d.deviceType || (d.devices?.[0] ?? ""),
      confidence: d.deviceType ? "High" : d.devices?.length ? "Medium" : "Low",
      hint: "Detected from issue text",
      sourceLabel: src(d.deviceType || d.devices?.[0] || ""),
    },
    {
      label: "Issue",
      value: d.issue || "",
      confidence: d.issue ? "Medium" : "Not confirmed",
      hint: "Ask for symptoms",
    },
    {
      label: "Error message",
      value: errorValue || "",
      confidence: answers.errorMessage
        ? "High"
        : d.errorMessage
          ? "Medium"
          : "Low",
      hint: "Ask for exact text on screen",
      answerKind: "errorMessage",
      sourceLabel: src(errorValue || ""),
    },
    {
      label: "Steps taken",
      value: (d.steps ?? []).join(" · "),
      confidence: (d.steps?.length ?? 0) > 0 ? "Medium" : "Low",
      hint: "What's been tried?",
    },
    {
      label: "Result",
      value: resultIsConfirmed ? resultLabel(effectiveResult as TicketResult) : "",
      confidence: answers.result
        ? "High"
        : resultIsConfirmed
          ? "Medium"
          : "Not confirmed",
      hint: "Ask: resolved, pending, or escalated?",
      answerKind: "result",
    },
  ];
}

interface MissingAlert {
  kind: LiveAssistAnswerKind;
  message: string;
  inputType: "text" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
}

function buildMissingAlerts(d: ExtractedDetails, answers: LiveAssistAnswers): MissingAlert[] {
  const alerts: MissingAlert[] = [];
  // Only show prompts the user hasn't already answered.
  if (!d.storeNumber && !answers.storeNumber) {
    alerts.push({
      kind: "storeNumber",
      message: "Ask for the store number.",
      inputType: "text",
      placeholder: "e.g. 523",
    });
  }
  if (!d.callerName && !answers.callerName) {
    alerts.push({
      kind: "callerName",
      message: "Ask for the caller's name.",
      inputType: "text",
      placeholder: "e.g. John Smith",
    });
  }
  // Only ask for register when it's clearly a register-class issue.
  const looksRegister =
    /\b(register|pos|cash\s*drawer|receipt|keyboard|verifone|pin\s*pad|scanner)\b/i.test(
      d.issue,
    ) ||
    d.deviceType ||
    (d.devices ?? []).length > 0;
  if (
    looksRegister &&
    !d.registerNumber &&
    !(d.affectedRegisters ?? []).length &&
    !answers.registerNumber
  ) {
    alerts.push({
      kind: "registerNumber",
      message: "Ask which register is affected.",
      inputType: "text",
      placeholder: "e.g. 2",
    });
  }
  if (d.issue && /\berror\b/i.test(d.issue) && !d.errorMessage && !answers.errorMessage) {
    alerts.push({
      kind: "errorMessage",
      message: "Ask for the exact error message on screen.",
      inputType: "text",
      placeholder: "e.g. PINPAD-100 timeout",
    });
  }
  if ((!d.result || d.result === "ResultNotConfirmed") && !answers.result) {
    alerts.push({
      kind: "result",
      message: "Ask: was the issue resolved, pending, or escalated?",
      inputType: "select",
      options: TICKET_RESULTS.filter(
        (r) => r.value !== "ResultNotConfirmed",
      ).map((r) => ({ value: r.value, label: r.label })),
    });
  }
  return alerts;
}

/**
 * Single editable row inside the Missing card. Holds local input state so
 * each keystroke doesn't fire a store update — only the Save / Enter does.
 */
function MissingAnswerRow({
  alert,
  onAnswer,
}: {
  alert: MissingAlert;
  onAnswer: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    if (!draft.trim()) return;
    onAnswer(draft);
    setDraft("");
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/70 bg-white/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100">
      <span className="mt-0.5 inline-block h-1.5 w-1.5 flex-none rounded-full bg-amber-500" />
      <span className="flex-1 leading-snug">{alert.message}</span>
      {alert.inputType === "select" ? (
        <select
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            if (v) {
              onAnswer(v);
              setDraft("");
            }
          }}
          className="h-8 min-w-[10rem] rounded-md border border-amber-300 bg-white px-2 text-sm text-amber-900 transition-colors focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <option value="">Select…</option>
          {alert.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={alert.placeholder}
          className="h-8 w-44 rounded-md border border-amber-300 bg-white px-2.5 text-sm text-amber-900 transition-colors placeholder:text-amber-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100 dark:placeholder:text-amber-500"
        />
      )}
      {alert.inputType === "text" && (
        <button
          type="button"
          onClick={commit}
          disabled={!draft.trim()}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-amber-600 px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="check" className="h-3 w-3" />
          Save
        </button>
      )}
    </li>
  );
}

function safeSuggestQuestions(d: ExtractedDetails): string[] {
  try {
    return suggestQuestions({
      typeOfTransaction: d.typeOfTransaction || "",
      category: d.category || "",
      issueText: d.issue || "",
      missingStore: !d.storeNumber,
      missingRegister: !d.registerNumber && (d.affectedRegisters ?? []).length === 0,
      missingTransaction: !d.transactionNumber,
      missingItem: !d.itemNumber,
      missingError: !d.errorMessage,
      missingResolution: !d.result || d.result === "ResultNotConfirmed",
      missingPayment: !d.paymentType,
      missingRequester: !d.callerName,
      partNeeded: d.partNeeded,
      partDeviceConfirmed: !!d.partRequest,
      existingTicketWithoutNumber: d.existingTicketMentioned && !d.vendorTicketNumber,
    });
  } catch {
    return [];
  }
}

function safeKnowledgeQuestions(d: ExtractedDetails, transcript: string): string[] {
  try {
    return knowledgeDrivenQuestions({ details: d, transcript });
  } catch {
    return [];
  }
}

function safeGuidedSteps(d: ExtractedDetails, transcript: string) {
  try {
    return guidedTroubleshootingSteps({ details: d, transcript });
  } catch {
    return [];
  }
}

function safePartSuggestion(d: ExtractedDetails, transcript: string) {
  try {
    return partRequestSuggestion({ details: d, transcript });
  } catch {
    return null;
  }
}

function safeSolutions(d: ExtractedDetails, transcript: string) {
  try {
    return suggestSolutionsForCurrent({ details: d, transcript });
  } catch {
    return [];
  }
}

function safeRelevantKnowledge(d: ExtractedDetails, transcript: string) {
  try {
    return relevantKnowledgeForCurrent({ details: d, transcript }, 4);
  } catch {
    return [];
  }
}

/**
 * Phase 16C — collapse duplicate KB matches and cap to 3 unique items.
 * "Store Unknown - Receipt Printer Issue" was rendering twice because
 * different code paths produced the same item id with different
 * casing/whitespace. Normalize on (id, title) before slicing.
 */
function dedupeRelevantKnowledge<
  T extends { item: { id?: string; title?: string } },
>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of list) {
    const id = entry.item?.id ?? "";
    const title = (entry.item?.title ?? "").trim().toLowerCase();
    const key = `${id}::${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= 3) break;
  }
  return out;
}

function mergeQuestions(base: string[], extra: string[]): string[] {
  const seen = new Set(base.map((q) => q.trim().toLowerCase()));
  const out = [...base];
  for (const q of extra) {
    const k = q.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

/**
 * Heuristic check: does the transcript already mention the step happening?
 * This is conservative — only marks a step as "✓" when the cleaned text
 * contains a substantive substring of the step. Wrong answers are
 * one-directional (we may miss a confirmed step, but we never falsely
 * claim a step was done that wasn't).
 */
function stepLooksConfirmed(step: string, transcript: string): boolean {
  const t = transcript.toLowerCase();
  const s = step.toLowerCase();
  // Pull out the most distinctive token in the step (e.g. "power drain" or "reseat cables").
  const distinctive = s.match(/(power\s+drain|reseat\s+cable[s]?|reboot|restart|reset|cache\s+rename|replace|reseated)/);
  if (distinctive) return t.includes(distinctive[0]);
  // Fall back to a multi-word substring match for steps that don't carry a
  // canonical phrase. Single-word matches would be too permissive.
  const words = s.split(/\s+/).filter((w) => w.length >= 4);
  if (words.length < 2) return false;
  const probe = words.slice(0, 2).join(" ");
  return t.includes(probe);
}

/**
 * Lightweight "looks done" check: transcript mentions a result word AND the
 * detected result moved off ResultNotConfirmed. Used to flip the badge from
 * "Listening" to "Looks ready to analyze" so the user knows when the assist
 * has effectively stabilized.
 */
function looksDoneish(d: ExtractedDetails): boolean {
  const hasResult = !!d.result && d.result !== "ResultNotConfirmed";
  const hasStore = !!d.storeNumber;
  return hasResult && hasStore;
}
