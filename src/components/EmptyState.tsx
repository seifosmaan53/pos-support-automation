import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  cta?: { label: string; to?: string; onClick?: () => void };
  secondary?: ReactNode;
}

export function EmptyState({ icon = "sparkle", title, description, cta, secondary }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300/80 bg-white/40 px-6 py-12 text-center backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-900/30">
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500/15 to-brand-500/5 text-brand-600 ring-1 ring-brand-500/20 dark:text-brand-300 dark:ring-brand-400/30">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {description}
        </p>
      )}
      {cta && (
        <div className="mt-4">
          {cta.to ? (
            <Link to={cta.to} className="btn-primary">
              {cta.label}
            </Link>
          ) : (
            <button type="button" className="btn-primary" onClick={cta.onClick}>
              {cta.label}
            </button>
          )}
        </div>
      )}
      {secondary && <div className="mt-3 text-xs text-slate-500 dark:text-slate-500">{secondary}</div>}
    </div>
  );
}
