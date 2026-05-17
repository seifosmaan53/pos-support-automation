import type { SavedTicket, TicketResult } from "../types/ticket";
import { resultLabel } from "../utils/resultWording";
import {
  hasAudio,
  audioWasDeleted,
  hasSpeakerTranscript,
  hasCorrectionAudit,
  hasPartRequest,
  hasNameCorrection,
  extractorAge,
} from "../utils/ticketFilters";

/**
 * Tailwind classes for each result tone. All use the same rounded-full pill
 * shape with a soft background + matching border, so the row of badges reads
 * as a unified vocabulary instead of a Christmas-tree of colors.
 */
function resultBadgeClass(r: TicketResult): string {
  const base = "border";
  switch (r) {
    case "Resolved":
      return `${base} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300`;
    case "PartsNeeded":
    case "Escalated":
    case "WaitingOnVendor":
      return `${base} border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800/70 dark:bg-orange-950/40 dark:text-orange-300`;
    case "WrongCaller":
      return `${base} border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300`;
    case "Transferred":
      return `${base} border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/70 dark:bg-violet-950/40 dark:text-violet-300`;
    case "Pending":
    case "FollowUpRequired":
    case "WaitingOnStore":
    case "Monitoring":
      return `${base} border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300`;
    case "StoreDidNotAnswer":
    case "CouldNotReproduce":
    case "ResultNotConfirmed":
    default:
      return `${base} border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`;
  }
}

interface BadgeProps {
  className: string;
  title?: string;
  children: React.ReactNode;
}

function Badge({ className, title, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
      title={title}
    >
      {children}
    </span>
  );
}

interface Props {
  ticket: SavedTicket;
  showCurrentExtractor?: boolean;
}

const NEUTRAL =
  "border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
const BRAND =
  "border border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800/70 dark:bg-brand-900/40 dark:text-brand-300";
const CYAN =
  "border border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800/70 dark:bg-cyan-950/40 dark:text-cyan-300";
const INDIGO =
  "border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/70 dark:bg-indigo-950/40 dark:text-indigo-300";
const FUCHSIA =
  "border border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800/70 dark:bg-fuchsia-950/40 dark:text-fuchsia-300";
const STONE =
  "border border-stone-200 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300";
const TEAL =
  "border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800/70 dark:bg-teal-950/40 dark:text-teal-300";
const AMBER =
  "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300";
const ROSE =
  "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300";
const SKY =
  "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-300";
const EMERALD =
  "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300";

export function TicketBadges({ ticket: t, showCurrentExtractor = false }: Props) {
  const age = extractorAge(t);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {t.details.storeNumber && (
        <Badge className={NEUTRAL} title="Store number">
          Store {t.details.storeNumber}
        </Badge>
      )}
      <Badge className={resultBadgeClass(t.details.result)} title="Outcome / status">
        {resultLabel(t.details.result)}
      </Badge>
      {t.details.category && (
        <Badge
          className={BRAND}
          title={t.details.subCategory ? `Category · ${t.details.subCategory}` : "Category"}
        >
          {t.details.category}
        </Badge>
      )}
      {t.details.registerNumber && (
        <Badge className={CYAN} title="Register number">
          Reg {t.details.registerNumber}
        </Badge>
      )}
      {t.details.deviceType && (
        <Badge className={INDIGO} title="Device type">
          {t.details.deviceType}
        </Badge>
      )}
      {hasAudio(t) && (
        <Badge className={FUCHSIA} title="Audio recording is saved with this ticket">
          Audio
        </Badge>
      )}
      {audioWasDeleted(t) && (
        <Badge className={STONE} title="Audio was deleted. Re-transcription is not possible.">
          Audio deleted
        </Badge>
      )}
      {hasSpeakerTranscript(t) && (
        <Badge className={TEAL} title="Saved speaker-labeled transcript">
          Speaker
        </Badge>
      )}
      {hasCorrectionAudit(t) && (
        <Badge className={AMBER} title="Has approved/undone correction history">
          Corrections
        </Badge>
      )}
      {hasPartRequest(t) && (
        <Badge className={ROSE} title="Part replacement was requested">
          Part request
        </Badge>
      )}
      {hasNameCorrection(t) && (
        <Badge className={ROSE} title="A caller-name correction was applied">
          Name fix
        </Badge>
      )}
      {age === "older" && (
        <Badge
          className={AMBER}
          title="This ticket was generated with an older analyzer version. You may want to re-run extraction."
        >
          Older extractor
        </Badge>
      )}
      {age === "legacy" && (
        <Badge
          className={STONE}
          title="Legacy ticket — predates the analyzer-version audit field. Re-run extraction for current results."
        >
          Legacy ticket
        </Badge>
      )}
      {showCurrentExtractor && age === "current" && (
        <Badge className={EMERALD} title="Generated with the current analyzer version">
          Current extractor
        </Badge>
      )}
      {t.reviewed && (
        <Badge className={SKY} title="Marked as reviewed">
          Reviewed
        </Badge>
      )}
    </div>
  );
}
