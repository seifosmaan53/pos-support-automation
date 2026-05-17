/**
 * Phase 11D — collapsible wrapper for advanced panels.
 *
 * On the Form Helper page, advanced suggestion panels (Suggested Solutions,
 * Guided Troubleshooting, Knowledge Base matches, Correction Toolbar,
 * Suggested Reminders) collapse by default so the user can focus on the
 * fields that need editing. When a panel has an important warning, the
 * caller passes `expandedByDefault` so it's already open on first paint.
 *
 * Built on the native <details> element so keyboard navigation, screen
 * readers, and "collapsed by default" all work without custom state.
 */

import { type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function CollapsibleSection({
  title,
  description,
  icon = "doc",
  badge,
  badgeTone = "neutral",
  expandedByDefault = false,
  children,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  /** Small chip rendered next to the title (e.g. count of warnings). */
  badge?: string;
  badgeTone?: "neutral" | "warning" | "danger" | "success";
  /**
   * Open the section on initial render. Pass true when the section has a
   * warning or pending action the user should see immediately.
   */
  expandedByDefault?: boolean;
  children: ReactNode;
}) {
  const badgeClass = BADGE_CLASS[badgeTone];

  return (
    <details
      open={expandedByDefault}
      className="card group space-y-3 transition-colors"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 -m-1 p-1 hover:bg-slate-50/40 rounded-lg dark:hover:bg-slate-800/30">
        <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Icon name={icon} className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {description}
            </p>
          )}
        </div>
        {badge && <span className={badgeClass}>{badge}</span>}
        <span className="inline-flex h-5 w-5 flex-none items-center justify-center text-slate-400 transition-transform group-open:rotate-90">
          <Icon name="arrowRight" className="h-3 w-3" />
        </span>
      </summary>
      <div className="pt-1">{children}</div>
    </details>
  );
}

const BADGE_CLASS: Record<string, string> = {
  neutral:
    "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  warning:
    "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300",
  danger:
    "inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300",
  success:
    "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300",
};
