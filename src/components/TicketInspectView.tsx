import { useMemo, useState } from "react";
import type { SavedTicket } from "../types/ticket";
import { speakerLabelText, type SpeakerLabel } from "../types/speaker";
import { CopyButton } from "./CopyButton";
import { TicketBadges } from "./TicketBadges";
import { AudioInspectSection } from "./AudioInspectSection";
import { buildFullTicketText } from "../services/ticketFieldGenerator";
import { ticketFeedbackStore } from "../services/ticketFeedbackStore";
import { styleExamplesStore } from "../services/styleExamplesStore";
import { remindersStore } from "../services/remindersStore";
import { ReminderQuickButtons } from "./ReminderQuickButtons";
import { AddToKnowledgeButton } from "./AddToKnowledgeButton";
import { useAppStore } from "../services/appStore";
import { inMinutes, tomorrowMorning } from "../services/reminderIntelligence";
import type { Reminder } from "../types/reminder";
import { resultLabel } from "../utils/resultWording";
import { formatDateTime } from "../utils/formatDate";
import { extractorAge } from "../utils/ticketFilters";
import type { TicketFeedback } from "../types/feedback";
import { useConfirm } from "./ConfirmDialog";

type Tab =
  | "overview"
  | "original"
  | "corrected"
  | "speaker"
  | "details"
  | "fields"
  | "summaries"
  | "audit"
  | "names"
  | "audio"
  | "feedback"
  | "reminders"
  | "metadata";

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  original: "Original Transcript",
  corrected: "Corrected Transcript",
  speaker: "Speaker Transcript",
  details: "Extracted Details",
  fields: "Ticket Fields",
  summaries: "Summary Versions",
  audit: "Correction Audit",
  names: "Name Corrections",
  audio: "Audio",
  feedback: "Feedback",
  reminders: "Reminders",
  metadata: "Metadata",
};

const SPEAKER_PILL: Record<string, string> = {
  tech_support: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  store_employee: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  store_manager: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  vendor: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  customer: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  wrong_caller: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  unknown: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

interface Props {
  ticket: SavedTicket;
  onReanalyzeFromSavedSpeaker: () => void | Promise<void>;
  onReanalyzeFromOriginal: () => void | Promise<void>;
  onMarkReviewed: () => void;
  onDelete: () => void;
  /** Called when the inspect view mutates ticket/audio state and the parent
   * list needs to re-pull from `ticketStore`. */
  onChange?: () => void;
}

function speakerTranscriptText(t: SavedTicket): string {
  return (t.speakerSegments ?? [])
    .map((s) => `${speakerLabelText(s.speakerLabel as SpeakerLabel)}: ${s.repairedText}`)
    .join("\n\n");
}

function fullTicketText(t: SavedTicket): string {
  return t.ticketFields ? buildFullTicketText(t.ticketFields) : t.generatedTicket;
}

export function TicketInspectView({
  ticket: t,
  onReanalyzeFromSavedSpeaker,
  onReanalyzeFromOriginal,
  onMarkReviewed,
  onDelete,
  onChange,
}: Props) {
  const [tab, setTab] = useState<Tab>("overview");

  const hasSpeaker = (t.speakerSegments?.length ?? 0) > 0;
  const hasCorrected = !!(t.correctedTranscript || t.transcript);
  const hasOriginal = !!(t.rawTranscript || t.transcript);
  const speakerText = hasSpeaker ? speakerTranscriptText(t) : "";
  const subject = t.ticketFields?.subject ?? "";
  const description = t.ticketFields?.description ?? "";
  const resolution = t.ticketFields?.resolution ?? "";

  const feedbackRows = ticketFeedbackStore.listByTicket(t.id);
  // Track reminders inside an inspect-local tick so creating from the
  // Reminders tab refreshes counts without needing onChange to bubble.
  const [reminderTick, setReminderTick] = useState(0);
  const reminderRows = useMemo(() => {
    void reminderTick;
    return remindersStore.listByTicket(t.id);
  }, [t.id, reminderTick]);
  const openReminders = reminderRows.filter(
    (r) => r.status === "open" || r.status === "snoozed",
  ).length;
  const completedReminders = reminderRows.filter((r) => r.status === "completed").length;

  const tabDisabled: Partial<Record<Tab, string>> = {
    original: hasOriginal ? undefined : "No original transcript saved.",
    corrected: hasCorrected ? undefined : "No corrected transcript saved.",
    speaker: hasSpeaker ? undefined : "No saved speaker transcript available.",
    audit:
      (t.approvedCorrections?.length ?? 0) +
        (t.undoneCorrections?.length ?? 0) +
        (t.userCorrectedSpeakerSegments?.length ?? 0) ===
      0
        ? "No correction audit trail."
        : undefined,
    names:
      (t.nameCorrectionsApplied?.length ?? 0) === 0
        ? "No name corrections recorded."
        : undefined,
    feedback: feedbackRows.length === 0 ? "No feedback recorded yet." : undefined,
  };

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <TicketBadges ticket={t} showCurrentExtractor />

      {(openReminders > 0 || completedReminders > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {openReminders > 0 && (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
              title="Open or snoozed reminders linked to this ticket."
            >
              ⏰ {openReminders} open reminder{openReminders === 1 ? "" : "s"}
            </span>
          )}
          {completedReminders > 0 && (
            <span
              className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
              title="Reminders completed for this ticket."
            >
              ✓ {completedReminders} completed
            </span>
          )}
        </div>
      )}

      <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2 dark:border-slate-700">
        {(Object.keys(TAB_LABELS) as Tab[]).map((id) => {
          const reason = tabDisabled[id];
          const disabled = !!reason;
          return (
            <button
              key={id}
              type="button"
              className={`rounded px-2 py-0.5 text-xs ${
                tab === id
                  ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900"
                  : "bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              onClick={() => !disabled && setTab(id)}
              disabled={disabled}
              title={reason}
            >
              {TAB_LABELS[id]}
            </button>
          );
        })}
      </nav>

      {tab === "overview" && (
        <OverviewTab ticket={t} subject={subject} description={description} resolution={resolution} />
      )}

      {tab === "original" && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          {t.rawTranscript || t.transcript || "(empty)"}
        </pre>
      )}

      {tab === "corrected" && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          {t.correctedTranscript || t.transcript || "(empty)"}
        </pre>
      )}

      {tab === "speaker" && (
        <SpeakerTab ticket={t} />
      )}

      {tab === "details" && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          {JSON.stringify(t.details, null, 2)}
        </pre>
      )}

      {tab === "fields" && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          {JSON.stringify(t.ticketFields ?? {}, null, 2)}
        </pre>
      )}

      {tab === "summaries" && (
        <div className="max-h-96 space-y-2 overflow-auto">
          {Object.entries(t.summaries ?? {}).map(([key, value]) => (
            <div
              key={key}
              className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">{key}</div>
              <p className="whitespace-pre-wrap text-xs">{(value as string) || "(empty)"}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "audit" && <AuditTab ticket={t} />}

      {tab === "names" && (
        <ul className="space-y-1 rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          {(t.nameCorrectionsApplied ?? []).map((n, i) => (
            <li key={i}>
              <span className="font-mono text-rose-700 dark:text-rose-300">{n.detected}</span>
              {" → "}
              <span className="font-mono text-emerald-700 dark:text-emerald-300">{n.corrected}</span>
            </li>
          ))}
        </ul>
      )}

      {tab === "audio" && <AudioInspectSection ticket={t} onChange={onChange ?? (() => undefined)} />}

      {tab === "feedback" && (
        <FeedbackTab feedbackRows={feedbackRows} ticketId={t.id} />
      )}

      {tab === "reminders" && (
        <RemindersTab
          ticket={t}
          reminders={reminderRows}
          onMutate={() => setReminderTick((n) => n + 1)}
        />
      )}

      {tab === "metadata" && <MetadataTab ticket={t} />}

      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
        <CopyButton
          text={subject}
          label="Copy Subject"
          className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
        />
        <CopyButton
          text={description}
          label="Copy Description"
          className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
        />
        <CopyButton
          text={resolution}
          label="Copy Resolution"
          className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
        />
        <CopyButton
          text={fullTicketText(t)}
          label="Copy Full Ticket"
          className="rounded bg-slate-700 px-2 py-1 text-xs text-white disabled:opacity-50"
        />
        <CopyButton
          text={speakerText}
          label="Copy Speaker Transcript"
          className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
        />
        <button
          type="button"
          className="rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50"
          onClick={() => void onReanalyzeFromSavedSpeaker()}
          disabled={!hasSpeaker}
          title={
            hasSpeaker
              ? "Re-run extraction using the saved speaker labels and corrected transcript."
              : "No saved speaker transcript available."
          }
        >
          Re-run from Saved Speaker Transcript
        </button>
        <button
          type="button"
          className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50"
          onClick={() => void onReanalyzeFromOriginal()}
          disabled={!hasOriginal}
          title={
            hasOriginal
              ? "Replay repair + speaker detection on the raw transcript."
              : "No original transcript saved."
          }
        >
          Re-run from Original Transcript
        </button>
        <button
          type="button"
          className="rounded border border-sky-400 px-2 py-1 text-xs text-sky-700 disabled:opacity-50 dark:border-sky-700 dark:text-sky-200"
          onClick={onMarkReviewed}
          disabled={t.reviewed}
          title={t.reviewed ? "Already marked reviewed." : "Mark this ticket as reviewed."}
        >
          {t.reviewed ? "Reviewed" : "Mark Reviewed"}
        </button>
        <AddToKnowledgeButton
          ticketId={t.id}
          className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
          label="Add to Knowledge Base"
        />
        <button
          type="button"
          className="ml-auto rounded bg-red-600 px-2 py-1 text-xs text-white"
          onClick={onDelete}
        >
          Delete Ticket
        </button>
      </div>
    </div>
  );
}

function OverviewTab({
  ticket: t,
  subject,
  description,
  resolution,
}: {
  ticket: SavedTicket;
  subject: string;
  description: string;
  resolution: string;
}) {
  const d = t.details;
  const additionalComments = t.ticketFields?.additionalComments ?? "";
  const partRequest = t.ticketFields?.partRequest || d.partRequest || "";
  const warnings = t.ticketFields?.missingInfoWarnings ?? d.missingInfo ?? [];
  const questions = t.ticketFields?.suggestedQuestions ?? d.suggestedQuestions ?? [];

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
      <Field label="Subject" value={subject} />
      <Field label="Description" value={description} multiline />
      <Field label="Resolution" value={resolution} multiline />
      {additionalComments && <Field label="Additional Comments" value={additionalComments} multiline />}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Store" value={d.storeNumber || "—"} />
        <Field label="Caller" value={d.callerName || "—"} />
        <Field label="Register" value={d.registerNumber || "—"} />
        <Field label="Device" value={d.deviceType || "—"} />
        <Field label="Result" value={resultLabel(d.result)} />
        <Field label="Part request" value={partRequest || "—"} />
      </div>

      {warnings.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">
            Warnings
          </div>
          <ul className="ml-4 list-disc text-xs text-amber-800 dark:text-amber-200">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {questions.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase text-sky-700 dark:text-sky-300">
            Suggested questions
          </div>
          <ul className="ml-4 list-disc text-xs text-sky-800 dark:text-sky-200">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <CopyLogSection ticket={t} />
    </div>
  );
}

/**
 * Phase 9: Copy Log section on the Inspect Overview tab.
 *
 * Shows which fields the user copied (with timestamps), which fields are
 * still uncopied per the user's field mapping, and whether the user marked
 * the Sequential Copy as complete.
 */
function CopyLogSection({ ticket }: { ticket: SavedTicket }) {
  const mapping = useAppStore((s) => s.settings.fieldMapping);
  const log = ticket.copyLog ?? [];
  const completed = !!ticket.copySequenceCompleted;

  const copiedKeys = new Set(log.map((e) => e.field));
  // Latest timestamp per field — multiple copies of the same field show the
  // most recent one in the list.
  const latestPerKey = new Map<string, string>();
  for (const e of log) {
    const prev = latestPerKey.get(e.field);
    if (!prev || prev.localeCompare(e.copiedAt) < 0) {
      latestPerKey.set(e.field, e.copiedAt);
    }
  }
  const visibleEntries = mapping.entries.filter((e) => e.enabled);
  const notCopied = visibleEntries.filter((e) => !copiedKeys.has(e.key));

  if (log.length === 0 && !completed) {
    return (
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
          Copy Log
        </div>
        <p className="text-[11px] italic text-slate-500">
          No fields copied yet for this ticket.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase text-slate-500">
          Copy Log
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            completed
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
          }`}
        >
          Copy sequence: {completed ? "completed" : "not completed"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
            Copied ({copiedKeys.size})
          </div>
          {copiedKeys.size === 0 ? (
            <p className="text-[11px] italic text-slate-500">No fields copied yet.</p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {[...latestPerKey.entries()].map(([key, copiedAt]) => {
                const entry = mapping.entries.find((e) => e.key === key);
                const label = entry?.label?.trim() || key;
                return (
                  <li key={key} className="flex items-baseline justify-between gap-2">
                    <span>{label}</span>
                    <span className="text-[10px] text-slate-500">
                      {formatDateTime(copiedAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase text-slate-500">
            Not copied ({notCopied.length})
          </div>
          {notCopied.length === 0 ? (
            <p className="text-[11px] italic text-emerald-700 dark:text-emerald-300">
              Every visible field has been copied at least once.
            </p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {notCopied.map((e) => {
                const label = e.label.trim() || e.key;
                return (
                  <li key={e.key} className="flex items-baseline justify-between gap-2">
                    <span>{label}</span>
                    {e.required && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        Required
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      {multiline ? (
        <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
          {value || "—"}
        </p>
      ) : (
        <p className="text-sm text-slate-700 dark:text-slate-200">{value || "—"}</p>
      )}
    </div>
  );
}

function SpeakerTab({ ticket: t }: { ticket: SavedTicket }) {
  if ((t.speakerSegments?.length ?? 0) === 0) {
    return (
      <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        No saved speaker transcript available for this ticket.
      </p>
    );
  }
  return (
    <div className="max-h-96 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
      {t.speakerSegments.map((s) => (
        <div key={s.id} className="mb-2 last:mb-0">
          <div className="mb-0.5 flex items-center gap-1">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                SPEAKER_PILL[s.speakerLabel] ?? SPEAKER_PILL.unknown
              }`}
            >
              {speakerLabelText(s.speakerLabel as SpeakerLabel)}
            </span>
            <span className="text-[10px] text-slate-500">
              {s.confidence}
              {s.userCorrected && " · ✓ corrected"}
            </span>
          </div>
          {s.reason && <p className="mb-0.5 text-[10px] italic text-slate-500">{s.reason}</p>}
          {s.originalText && s.originalText !== s.repairedText ? (
            <>
              <p className="text-[11px] text-slate-500 line-through">Original: {s.originalText}</p>
              <p className="leading-relaxed text-slate-700 dark:text-slate-200">
                Repaired: {s.repairedText}
              </p>
            </>
          ) : (
            <p className="leading-relaxed text-slate-700 dark:text-slate-200">{s.repairedText}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function AuditTab({ ticket: t }: { ticket: SavedTicket }) {
  const approved = t.approvedCorrections ?? [];
  const undone = t.undoneCorrections ?? [];
  const speakerCorrections = (t.userCorrectedSpeakerSegments ?? []).map((s, i) => ({
    idx: i + 1,
    speaker: s.speakerLabel as SpeakerLabel,
    text: s.repairedText.slice(0, 80),
  }));

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
      {approved.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
            Applied corrections ({approved.length})
          </h3>
          <ul className="ml-4 list-disc">
            {approved.map((c, i) => (
              <li key={i}>
                <span className="font-mono text-rose-700 dark:text-rose-300">{c.from}</span>
                {" → "}
                <span className="font-mono text-emerald-700 dark:text-emerald-300">{c.to}</span>
                <span className="ml-1 text-[10px] text-slate-500">({c.source})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {undone.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-300">
            Undone suggestions ({undone.length})
          </h3>
          <ul className="ml-4 list-disc">
            {undone.map((c, i) => (
              <li key={i}>
                {c.from} → {c.to}{" "}
                <span className="text-[10px] text-slate-500">({c.source})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {speakerCorrections.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase text-violet-700 dark:text-violet-300">
            Speaker label corrections ({speakerCorrections.length})
          </h3>
          <ul className="ml-4 list-disc">
            {speakerCorrections.map((s) => (
              <li key={s.idx}>
                Segment {s.idx} → {speakerLabelText(s.speaker)}: "{s.text}…"
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MetadataTab({ ticket: t }: { ticket: SavedTicket }) {
  const age = extractorAge(t);
  const ageLabel =
    age === "current"
      ? "Current extractor"
      : age === "older"
        ? "Older extractor"
        : "Legacy ticket (predates audit field)";
  return (
    <div className="rounded border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Meta label="Ticket ID" value={t.id} mono />
        <Meta label="Created" value={formatDateTime(t.createdAt)} />
        <Meta label="Updated" value={formatDateTime(t.updatedAt || t.createdAt)} />
        <Meta label="Detail level" value={t.detailLevel} />
        <Meta label="Reviewed" value={t.reviewed ? "Yes" : "No"} />
        <Meta label="Copied" value={t.copied ? "Yes" : "No"} />
        <Meta label="Extractor version" value={t.extractionSourceVersion || "(none)"} mono />
        <Meta label="Extraction status" value={ageLabel} />
        <Meta
          label="Extraction timestamp"
          value={t.extractionTimestamp ? formatDateTime(t.extractionTimestamp) : "—"}
        />
      </dl>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase text-slate-500">{label}</dt>
      <dd className={`text-xs text-slate-700 dark:text-slate-200 ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function FeedbackTab({
  feedbackRows,
  ticketId,
}: {
  feedbackRows: TicketFeedback[];
  ticketId: string;
}) {
  // Resolve linked style example titles up-front so the render is sync.
  const linkedExampleTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of feedbackRows) {
      if (!f.styleExampleId) continue;
      const ex = styleExamplesStore.get(f.styleExampleId);
      if (ex) map.set(f.styleExampleId, ex.title);
    }
    return map;
  }, [feedbackRows]);

  if (feedbackRows.length === 0) {
    return (
      <div className="space-y-2">
        <p className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px] italic text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
          No feedback recorded yet. Use the Correction Feedback toolbar on the Ticket Form
          Helper page to capture corrections, missed details, or resolution outcomes.
        </p>
        <AddToKnowledgeButton
          ticketId={ticketId}
          className="btn-secondary text-xs"
          label="Add to Knowledge Base"
        />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <AddToKnowledgeButton
          ticketId={ticketId}
          className="btn-secondary text-xs"
          label="Add to Knowledge Base"
        />
      </div>
      {feedbackRows.map((f) => (
        <div
          key={f.id}
          className="rounded border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              Feedback row · {formatDateTime(f.createdAt)}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                f.resolutionWorked === "worked"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                  : f.resolutionWorked === "did-not-work"
                    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                    : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
              }`}
            >
              Resolution:{" "}
              {f.resolutionWorked === "worked"
                ? "Worked"
                : f.resolutionWorked === "did-not-work"
                  ? "Did not work"
                  : "Unknown"}
            </span>
          </div>

          {f.whatAiMissed && (
            <section className="mb-2">
              <h4 className="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">
                AI missed
              </h4>
              <p className="whitespace-pre-wrap text-xs text-amber-800 dark:text-amber-200">
                {f.whatAiMissed}
              </p>
            </section>
          )}

          {f.correctedFields.length > 0 && (
            <section className="mb-2">
              <h4 className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                Field corrections ({f.correctedFields.length})
              </h4>
              <ul className="space-y-1">
                {f.correctedFields.map((c, i) => (
                  <li key={i} className="rounded bg-slate-50 p-1.5 dark:bg-slate-800/40">
                    <div className="text-[10px] font-semibold uppercase text-slate-500">
                      {c.field}
                    </div>
                    {c.before && (
                      <div className="text-[11px] text-rose-700 line-through dark:text-rose-300">
                        {c.before}
                      </div>
                    )}
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                      {c.after}
                    </div>
                    {c.note && (
                      <div className="mt-0.5 text-[10px] italic text-slate-500">{c.note}</div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(f.originalSubject || f.correctedSubject) && (
            <DiffRow label="Subject" before={f.originalSubject} after={f.correctedSubject} />
          )}
          {(f.originalDescription || f.correctedDescription) && (
            <DiffRow
              label="Description"
              before={f.originalDescription}
              after={f.correctedDescription}
            />
          )}
          {(f.originalResolution || f.correctedResolution) && (
            <DiffRow
              label="Resolution"
              before={f.originalResolution}
              after={f.correctedResolution}
            />
          )}

          {f.styleExampleId && (
            <p className="mt-2 text-[11px] text-sky-700 dark:text-sky-300">
              Style example created from this ticket:{" "}
              <strong>{linkedExampleTitles.get(f.styleExampleId) ?? f.styleExampleId}</strong>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function RemindersTab({
  ticket: t,
  reminders,
  onMutate,
}: {
  ticket: SavedTicket;
  reminders: Reminder[];
  onMutate: () => void;
}) {
  const complete = useAppStore((s) => s.completeReminder);
  const snooze = useAppStore((s) => s.snoozeReminder);
  const dismiss = useAppStore((s) => s.dismissReminder);
  const remove = useAppStore((s) => s.deleteReminder);
  const settings = useAppStore((s) => s.settings);
  const snoozeMinutes = settings.reminderSettings.defaultSnoozeMinutes || 30;
  const askConfirm = useConfirm();

  function handleComplete(id: string) {
    complete(id);
    onMutate();
  }
  function handleSnooze30(id: string) {
    snooze(id, inMinutes(snoozeMinutes));
    onMutate();
  }
  function handleSnoozeTomorrow(id: string) {
    snooze(id, tomorrowMorning());
    onMutate();
  }
  function handleDismiss(id: string) {
    dismiss(id);
    onMutate();
  }
  async function handleDelete(id: string, title: string) {
    if (settings.askBeforeDelete) {
      const ok = await askConfirm({
        title: "Delete reminder?",
        message: <>This will remove <span className="font-semibold">{title}</span>. This cannot be undone.</>,
        destructive: true,
      });
      if (!ok) return;
    }
    remove(id);
    onMutate();
  }

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
      <div>
        <h3 className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
          Create reminder for this ticket
        </h3>
        <ReminderQuickButtons
          details={t.details}
          fields={t.ticketFields}
          transcript={t.rawTranscript || t.transcript || ""}
          ticketId={t.id}
          compact
        />
        <p className="mt-1 text-[11px] italic text-slate-500">
          New reminders show up here and on the Reminders page.
        </p>
      </div>

      {reminders.length === 0 ? (
        <p className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px] italic text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
          No reminders linked to this ticket yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {reminders.map((r) => {
            const isClosed = r.status === "completed" || r.status === "dismissed";
            return (
              <li
                key={r.id}
                className="rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/40"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_PILL[r.status] ?? STATUS_PILL.open}`}>
                    {r.status}
                  </span>
                  <span className="font-medium">{r.title}</span>
                  {r.dueAt && (
                    <span className="text-[10px] text-slate-500">
                      Due {formatDateTime(r.dueAt)}
                    </span>
                  )}
                </div>
                {r.message && (
                  <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-200">
                    {r.message}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-1">
                  {!isClosed && (
                    <button
                      className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white"
                      onClick={() => handleComplete(r.id)}
                    >
                      Mark Complete
                    </button>
                  )}
                  {r.status === "open" && (
                    <>
                      <button
                        className="rounded border border-slate-300 px-2 py-0.5 text-[10px] dark:border-slate-600"
                        onClick={() => handleSnooze30(r.id)}
                      >
                        Snooze {snoozeMinutes}m
                      </button>
                      <button
                        className="rounded border border-slate-300 px-2 py-0.5 text-[10px] dark:border-slate-600"
                        onClick={() => handleSnoozeTomorrow(r.id)}
                      >
                        Snooze Tomorrow
                      </button>
                    </>
                  )}
                  {!isClosed && (
                    <button
                      className="rounded border border-slate-300 px-2 py-0.5 text-[10px] dark:border-slate-600"
                      onClick={() => handleDismiss(r.id)}
                    >
                      Dismiss
                    </button>
                  )}
                  <button
                    className="ml-auto rounded bg-red-600 px-2 py-0.5 text-[10px] text-white"
                    onClick={() => handleDelete(r.id, r.title)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const STATUS_PILL: Record<string, string> = {
  open: "bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  snoozed: "bg-sky-200 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  completed: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  dismissed: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
  if (!before && !after) return null;
  if (before === after) return null;
  return (
    <div className="mb-1">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      {before && (
        <p className="whitespace-pre-wrap text-[11px] text-rose-700 line-through dark:text-rose-300">
          {before}
        </p>
      )}
      {after && (
        <p className="whitespace-pre-wrap text-[11px] text-emerald-700 dark:text-emerald-300">
          {after}
        </p>
      )}
    </div>
  );
}
