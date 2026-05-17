/**
 * Phase 16C — Next Step card.
 *
 * Pure derivation from the current workflow state into a single
 * "what should I do next" sentence + a primary-action label. Keeps the
 * New Ticket page navigable without making the user read three other
 * panels first.
 *
 * The cases are ordered by precedence — earlier branches win. Tests
 * (alongside the assessor) cover each branch.
 */
import { Link } from "react-router-dom";
import type { QualityVerdict } from "../services/transcriptQuality";

export interface NextStepInput {
  hasRecording: boolean;
  isRecording: boolean;
  hasTranscript: boolean;
  transcriptVerdict: QualityVerdict | null;
  hasAnalyzed: boolean;
  hasGeneratedFields: boolean;
  hasSavedTicket: boolean;
  audioAttached: boolean;
}

export interface NextStepResult {
  title: string;
  body: string;
  to?: string;
  toLabel?: string;
}

export function deriveNextStep(input: NextStepInput): NextStepResult {
  if (input.isRecording) {
    return {
      title: "Recording in progress",
      body: "Click Stop when the call ends.",
    };
  }
  if (!input.hasRecording && !input.hasTranscript) {
    return {
      title: "Start the call",
      body: "Record a call or paste a transcript below.",
    };
  }
  if (input.hasRecording && !input.hasTranscript) {
    return {
      title: "Transcribe the recording",
      body: "Click Transcribe — whisper.cpp runs locally — or paste a transcript manually.",
    };
  }
  if (input.hasTranscript && input.transcriptVerdict && !input.transcriptVerdict.shouldAnalyze) {
    return {
      title: "Improve the transcript before analyzing",
      body:
        "The transcript quality gate says the captured text isn't reliable enough. Re-record, re-transcribe, or edit it. You can also Analyze Anyway — outputs will be flagged review-required.",
      to: "/transcript",
      toLabel: "Edit transcript",
    };
  }
  if (input.hasTranscript && !input.hasAnalyzed) {
    return {
      title: "Review and analyze",
      body: "Review the transcript, then click Analyze Transcript.",
    };
  }
  if (input.hasGeneratedFields && !input.hasSavedTicket) {
    return {
      title: "Continue to ticket fields",
      body: "Use Copy Mode to paste each field into your ticket system, then Save.",
      to: "/form",
      toLabel: "Open Ticket Form Helper",
    };
  }
  if (input.hasSavedTicket && !input.audioAttached && input.hasRecording) {
    return {
      title: "Attach the recording",
      body: "Save the ticket to attach the recording, or use Attach Existing Recording on the Audio Status card.",
    };
  }
  return {
    title: "Ready",
    body: "Workflow complete — open History to inspect the saved ticket.",
    to: "/history",
    toLabel: "Open History",
  };
}

export function NextStepCard({ input }: { input: NextStepInput }) {
  const step = deriveNextStep(input);
  return (
    <section className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-sm dark:border-brand-800/60 dark:bg-brand-950/30">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            Next step
          </div>
          <div className="mt-0.5 font-medium">{step.title}</div>
          <p className="mt-1 text-slate-700 dark:text-slate-300">{step.body}</p>
        </div>
        {step.to && step.toLabel && (
          <Link to={step.to} className="btn-ghost text-xs">
            {step.toLabel}
          </Link>
        )}
      </div>
    </section>
  );
}
