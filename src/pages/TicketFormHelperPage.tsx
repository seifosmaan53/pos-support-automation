import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { CopyModePanel } from "../components/CopyModePanel";
import { CopyFullTicketMenu } from "../components/CopyFullTicketMenu";
import { TicketFieldCard } from "../components/TicketFieldCard";
import { SummaryVersionSelector } from "../components/SummaryVersionSelector";
import { CopyButton } from "../components/CopyButton";
import { WarningBox } from "../components/WarningBox";
import { SelfReviewBanner } from "../components/SelfReviewBanner";
import { NameCorrection } from "../components/NameCorrection";
import { CorrectionToolbar } from "../components/CorrectionToolbar";
import { SuggestedSolutionsPanel } from "../components/SuggestedSolutionsPanel";
import { GuidedTroubleshootingPanel } from "../components/GuidedTroubleshootingPanel";
import { knowledgeDrivenQuestions } from "../services/knowledgeIntelligence";
import { AudioStatusCard } from "../components/AudioStatusCard";
import { PilotFeedbackChips } from "../components/PilotFeedbackChips";
import { useGuardedSave } from "../hooks/useGuardedSave";
import { WorkflowSteps } from "../components/WorkflowSteps";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { SuggestedRemindersPanel } from "../components/SuggestedRemindersPanel";
import { ReminderQuickButtons } from "../components/ReminderQuickButtons";
import { EmptyState } from "../components/EmptyState";
import {
  buildAllFieldsBlock,
  buildFullTicketText,
  buildPartRequest,
  generateTicketFields,
} from "../services/ticketFieldGenerator";
import type { SummaryVariant, TicketFields } from "../types/ticket";

export function TicketFormHelperPage() {
  const fields = useAppStore((s) => s.ticketFields);
  const patch = useAppStore((s) => s.patchTicketFields);
  const reset = useAppStore((s) => s.resetTicketFields);
  const regenerate = useAppStore((s) => s.regenerateFromDetails);
  const summaries = useAppStore((s) => s.summaries);
  const selectedSummary = useAppStore((s) => s.selectedSummary);
  const setSelectedSummary = useAppStore((s) => s.setSelectedSummary);
  const transcript = useAppStore((s) => s.transcript);
  const corrections = useAppStore((s) => s.corrections);
  const details = useAppStore((s) => s.details);
  const settings = useAppStore((s) => s.settings);
  const save = useGuardedSave();
  const markReviewed = useAppStore((s) => s.markReviewed);
  const stage = useAppStore((s) => s.stage);
  const currentTicketId = useAppStore((s) => s.currentTicketId);
  const selfReview = useAppStore((s) => s.selfReview);
  const rerunSelfReview = useAppStore((s) => s.rerunSelfReview);
  const saveNameCorrection = useAppStore((s) => s.saveNameCorrection);
  const applyNameCorrection = useAppStore((s) => s.applyNameCorrection);
  const navigate = useNavigate();
  const [copyMode, setCopyMode] = useState(false);

  const existingNameHint = details.callerName
    ? settings.nameCorrections.find(
        (n) => n.detected === details.callerName.trim().toLowerCase(),
      )?.corrected
    : undefined;

  const hasContent = fields.subject.trim().length > 0 || fields.description.trim().length > 0;
  const fullTicket = buildFullTicketText(fields);
  const allFieldsBlock = buildAllFieldsBlock(fields);
  const currentSummary = summaries[selectedSummary] || "";

  // Phase 7: layer KB-driven questions on top of the rule-based ones the
  // analyzer produced. Dedupe by case-insensitive text — saved ticket data
  // stays untouched (so self-tests keep passing); only the display widens.
  const displayedQuestions = (() => {
    const baseList = fields.suggestedQuestions ?? [];
    const seen = new Set(baseList.map((q) => q.trim().toLowerCase()));
    const extra = knowledgeDrivenQuestions({
      details,
      transcript,
      fields,
    }).filter((q) => {
      const k = q.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return [...baseList, ...extra];
  })();

  function setField<K extends keyof TicketFields>(key: K, value: TicketFields[K]) {
    patch({ [key]: value } as Partial<TicketFields>);
  }

  function resetField<K extends keyof TicketFields>(key: K) {
    const fresh = generateTicketFields({
      details,
      technicianName: settings.technicianName,
      writingStyle: settings.writingStyle,
    });
    patch({ [key]: fresh[key] } as Partial<TicketFields>);
  }

  function regeneratePartRequest() {
    patch({ partRequest: buildPartRequest(details) });
  }

  if (stage === "idle" || (!hasContent && !details.issue)) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <header>
          <h1 className="page-title">Ticket Form Helper</h1>
          <p className="page-subtitle">
            Generates copyable values for every field in your real ticketing system.
          </p>
        </header>
        <EmptyState
          icon="copy"
          title="Nothing to fill in yet"
          description="Drop a transcript on Voice Ticket and click Analyze — every field your ticket system needs lands here, ready to copy one-by-one or all at once."
          cta={{ label: "Go to Voice Ticket", to: "/voice" }}
          secondary={
            <>
              Tip: Copy Mode steps you through every field in your ticket-system order.
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="page-title">Ticket Form Helper</h1>
          <p className="page-subtitle">
            Each field maps to a field in your ticket system. Edit, then click Copy. Yellow badges
            mark fields that need a human check.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => navigate("/transcript")}>
            Back to Transcript
          </button>
          <button className="btn-secondary" onClick={() => navigate("/details")}>
            Back to Extracted
          </button>
          <button
            className={copyMode ? "btn-primary" : "btn-secondary"}
            onClick={() => setCopyMode((v) => !v)}
            disabled={!hasContent}
            title={
              hasContent
                ? "Step through fields in your real ticketing-system order."
                : "Generate a ticket first."
            }
          >
            {copyMode ? "Exit Copy Mode" : "Copy Mode"}
          </button>
        </div>
      </header>

      <WorkflowSteps />

      <AudioStatusCard compact />

      {currentTicketId && <PilotFeedbackChips ticketId={currentTicketId} compact />}

      {copyMode && <CopyModePanel onExit={() => setCopyMode(false)} />}

      {selfReview.fields.length > 0 && (
        <SelfReviewBanner review={selfReview} onRerun={rerunSelfReview} />
      )}

      <CollapsibleSection
        title="Suggested Solutions"
        description="Past tickets with similar issues."
        icon="sparkle"
      >
        <SuggestedSolutionsPanel />
      </CollapsibleSection>

      <CollapsibleSection
        title="Guided Troubleshooting"
        description="Step-by-step playbook for this issue type."
        icon="shield"
      >
        <GuidedTroubleshootingPanel />
      </CollapsibleSection>

      <CollapsibleSection
        title="Correction Toolbar"
        description="Apply learned ASR corrections to the transcript."
        icon="doc"
        expandedByDefault={corrections.length > 0}
        badge={corrections.length > 0 ? `${corrections.length} pending` : undefined}
        badgeTone={corrections.length > 0 ? "warning" : "neutral"}
      >
        <CorrectionToolbar />
      </CollapsibleSection>

      {details.callerName && (
        <NameCorrection
          detectedName={details.callerName}
          confidenceNotes={details.confidenceNotes ?? []}
          onApply={applyNameCorrection}
          onSave={saveNameCorrection}
          existingCorrection={existingNameHint}
        />
      )}

      {(fields.capturedNotices.length > 0 || corrections.length > 0) && (
        <section className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between">
            <h2 className="text-base font-semibold">Notifications</h2>
            <span className="text-xs text-slate-500">
              Auto-corrections + captured details
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {fields.capturedNotices.map((n) => (
              <span
                key={n}
                className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
              >
                ✓ {n}
              </span>
            ))}
            {corrections.map((c, i) => (
              <span
                key={`${c.from}-${i}`}
                className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                title={`Auto-corrected '${c.from}' to '${c.to}'`}
              >
                ↺ "{c.from}" → "{c.to}"
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="label">Summary version</div>
          <SummaryVersionSelector value={selectedSummary} onChange={setSelectedSummary} />
        </div>
        <textarea
          className="input min-h-[120px] text-sm"
          rows={selectedSummary === "original" ? 8 : 5}
          value={currentSummary}
          readOnly
        />
        <div className="flex flex-wrap gap-2">
          <CopyButton
            text={currentSummary}
            label={`Copy ${SUMMARY_LABEL[selectedSummary]}`}
            className="btn-secondary"
          />
          <button
            className="btn-ghost"
            onClick={() => setSelectedSummary("original")}
            disabled={selectedSummary === "original"}
            title="Show the raw transcript again"
          >
            View Original Transcript
          </button>
          <button
            className="btn-ghost"
            onClick={() => setSelectedSummary("clean")}
            disabled={selectedSummary === "clean"}
            title="Show the lightly-cleaned transcript"
          >
            View Cleaned Transcript
          </button>
          <button
            className="btn-ghost"
            onClick={() => setSelectedSummary("cleanSummary")}
            disabled={selectedSummary === "cleanSummary"}
            title="Show a faithful 2-4 sentence summary"
          >
            View Original Summary
          </button>
          <button
            className="btn-ghost"
            onClick={regenerate}
            title="Rebuild summaries and ticket fields from the current Extracted Details"
          >
            Regenerate Summary
          </button>
          <span className="ml-auto text-xs text-slate-500">
            {transcript.length} chars in original transcript.
          </span>
        </div>
      </section>

      {fields.missingInfoWarnings.length > 0 && (
        <WarningBox tone="warning" title="Missing information warnings">
          <ul className="list-disc space-y-1 pl-5">
            {fields.missingInfoWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </WarningBox>
      )}

      {displayedQuestions.length > 0 && (
        <section className="card space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Suggested Questions for Next Call</h2>
              <p className="text-xs text-slate-500">
                Based on missing information, the issue type, and your
                Knowledge Base.
              </p>
            </div>
            <CopyButton
              text={displayedQuestions.map((q) => `- ${q}`).join("\n")}
              label="Copy Questions"
              className="btn-secondary"
            />
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {displayedQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      <Section title="Store Request">
        <FieldGrid>
          <TicketFieldCard
            label="Site"
            value={fields.site}
            onChange={(v) => setField("site", v)}
            onReset={() => resetField("site")}
            hint="Default: Stores"
          />
          <TicketFieldCard
            label="Store Number"
            value={fields.storeNumber}
            onChange={(v) => setField("storeNumber", v)}
            onReset={() => resetField("storeNumber")}
          />
          <TicketFieldCard
            label="Register #"
            value={fields.registerNumber}
            onChange={(v) => setField("registerNumber", v)}
            onReset={() => resetField("registerNumber")}
          />
          <TicketFieldCard
            label="Date/Time of Issue"
            value={fields.dateTimeOfIssue}
            onChange={(v) => setField("dateTimeOfIssue", v)}
            onReset={() => resetField("dateTimeOfIssue")}
          />
          <TicketFieldCard
            label="Contact Name"
            value={fields.contactName}
            onChange={(v) => setField("contactName", v)}
            onReset={() => resetField("contactName")}
          />
          <TicketFieldCard
            label="Requester Name"
            value={fields.requesterName}
            onChange={(v) => setField("requesterName", v)}
            onReset={() => resetField("requesterName")}
          />
          <TicketFieldCard
            label="Impact"
            value={fields.impact}
            onChange={(v) => setField("impact", v)}
            onReset={() => resetField("impact")}
            hint="Default: Affects Store"
          />
          <TicketFieldCard
            label="Urgency"
            value={fields.urgency}
            onChange={(v) => setField("urgency", v)}
            onReset={() => resetField("urgency")}
            hint="Default: Normal"
          />
          <TicketFieldCard
            label="Mode"
            value={fields.mode}
            onChange={(v) => setField("mode", v)}
            onReset={() => resetField("mode")}
            hint="Default: Phone Call"
          />
          <TicketFieldCard
            label="Request Type"
            value={fields.requestType}
            onChange={(v) => setField("requestType", v)}
            onReset={() => resetField("requestType")}
            hint="Default: Incident"
          />
          <TicketFieldCard
            label="Service Category"
            value={fields.serviceCategory}
            onChange={(v) => setField("serviceCategory", v)}
            onReset={() => resetField("serviceCategory")}
          />
          <TicketFieldCard
            label="Status"
            value={fields.status}
            onChange={(v) => setField("status", v)}
            onReset={() => resetField("status")}
            hint="Default: Open"
          />
        </FieldGrid>
      </Section>

      <Section title="Requester Details">
        <FieldGrid>
          <TicketFieldCard
            label="Category"
            value={fields.category}
            onChange={(v) => setField("category", v)}
            onReset={() => resetField("category")}
            hint="Suggested"
          />
          <TicketFieldCard
            label="Sub Category"
            value={fields.subCategory}
            onChange={(v) => setField("subCategory", v)}
            onReset={() => resetField("subCategory")}
            hint="Suggested"
          />
          <TicketFieldCard
            label="Item"
            value={fields.item}
            onChange={(v) => setField("item", v)}
            onReset={() => resetField("item")}
            hint="Suggested"
          />
          <TicketFieldCard
            label="Transaction #"
            value={fields.transactionNumber}
            onChange={(v) => setField("transactionNumber", v)}
            onReset={() => resetField("transactionNumber")}
          />
          <TicketFieldCard
            label="Item #"
            value={fields.itemNumber}
            onChange={(v) => setField("itemNumber", v)}
            onReset={() => resetField("itemNumber")}
          />
          <TicketFieldCard
            label="Type of Transaction"
            value={fields.typeOfTransaction}
            onChange={(v) => setField("typeOfTransaction", v)}
            onReset={() => resetField("typeOfTransaction")}
          />
          <TicketFieldCard
            label="Payment Type"
            value={fields.paymentType}
            onChange={(v) => setField("paymentType", v)}
            onReset={() => resetField("paymentType")}
          />
        </FieldGrid>
      </Section>

      <Section title="Subject and Description">
        <FieldGrid>
          <TicketFieldCard
            label="Technician"
            value={fields.technician}
            onChange={(v) => setField("technician", v)}
            onReset={() => resetField("technician")}
            hint="From Settings → General"
          />
        </FieldGrid>
        <TicketFieldCard
          label="Subject"
          value={fields.subject}
          onChange={(v) => setField("subject", v)}
          onReset={() => resetField("subject")}
          hint="Format: Store XXXXX - Issue"
        />
        <TicketFieldCard
          label="Description"
          value={fields.description}
          onChange={(v) => setField("description", v)}
          onReset={() => resetField("description")}
          multiline
          rows={5}
        />
      </Section>

      <Section title="Resolution">
        <TicketFieldCard
          label="Resolution"
          value={fields.resolution}
          onChange={(v) => setField("resolution", v)}
          onReset={() => resetField("resolution")}
          multiline
          rows={3}
        />
      </Section>

      {(details.partNeeded || fields.partRequest) && (
        <Section title="Part Request">
          <TicketFieldCard
            label="Part Request"
            value={fields.partRequest}
            onChange={(v) => setField("partRequest", v)}
            onReset={regeneratePartRequest}
            multiline
            rows={3}
            hint={details.partNeeded ? "Auto-detected" : "Optional"}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <CopyButton
              text={fields.partRequest}
              label="Copy Part Request"
              className="btn-secondary"
            />
            <button className="btn-ghost" onClick={regeneratePartRequest}>
              Regenerate Part Request
            </button>
          </div>
        </Section>
      )}

      <Section title="Additional Info">
        <TicketFieldCard
          label="Forward To"
          value={fields.forwardTo}
          onChange={(v) => setField("forwardTo", v)}
          onReset={() => resetField("forwardTo")}
        />
        <TicketFieldCard
          label="Additional Comments"
          value={fields.additionalComments}
          onChange={(v) => setField("additionalComments", v)}
          onReset={() => resetField("additionalComments")}
          multiline
          rows={3}
        />
      </Section>

      <CollapsibleSection
        title="Suggested Reminders"
        description="One-tap follow-ups (callbacks, vendor escalations, etc.)."
        icon="bell"
      >
        <SuggestedRemindersPanel />
      </CollapsibleSection>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Reminders</h2>
        <p className="text-xs text-slate-500">
          Save a follow-up linked to this ticket. Reminders surface on the
          banner when due and on the Reminders page.
        </p>
        <ReminderQuickButtons />
      </section>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Copy Tools</h2>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={fields.subject} label="Copy Subject" className="btn-secondary" />
          <CopyButton
            text={fields.description}
            label="Copy Description"
            className="btn-secondary"
          />
          <CopyButton
            text={fields.resolution}
            label="Copy Resolution"
            className="btn-secondary"
          />
          {fields.partRequest && (
            <CopyButton
              text={fields.partRequest}
              label="Copy Part Request"
              className="btn-secondary"
            />
          )}
          <CopyButton
            text={fields.additionalComments}
            label="Copy Additional Comments"
            className="btn-secondary"
          />
          <CopyButton text={allFieldsBlock} label="Copy All Fields" className="btn-secondary" />
          <CopyFullTicketMenu />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button className="btn-secondary" onClick={regenerate}>
            Regenerate Fields
          </button>
          <button className="btn-ghost" onClick={reset}>
            Reset All to Generated
          </button>
          <button
            className="btn-secondary"
            onClick={() => save()}
            disabled={!hasContent || settings.disableHistory}
            title={settings.disableHistory ? "History disabled in Settings" : "Save to local history"}
          >
            Save Ticket
          </button>
          <button
            className="btn-secondary"
            onClick={markReviewed}
            disabled={!hasContent || settings.disableHistory}
          >
            Mark Reviewed
          </button>
        </div>
      </section>

      <section className="card">
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            Preview: Full Ticket Text
          </summary>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 dark:bg-slate-950/50 dark:text-slate-200">
            {fullTicket}
          </pre>
        </details>
      </section>
    </div>
  );
}

const SUMMARY_LABEL: Record<SummaryVariant, string> = {
  original: "Original Transcript",
  clean: "Cleaned Transcript",
  cleanSummary: "Original Summary",
  short: "Short Summary",
  normal: "Normal Description",
  detailed: "Detailed Summary",
  technical: "Technical Summary",
  management: "Management Summary",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
