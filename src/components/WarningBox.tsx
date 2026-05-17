import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Tone = "warning" | "info" | "danger" | "success";

const TONE: Record<
  Tone,
  { box: string; iconWrap: string; icon: IconName; titleColor: string }
> = {
  warning: {
    box: "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-100",
    iconWrap: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200",
    icon: "alertTriangle",
    titleColor: "text-amber-900 dark:text-amber-50",
  },
  info: {
    box: "border-sky-200 bg-sky-50/70 text-sky-900 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-100",
    iconWrap: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200",
    icon: "info",
    titleColor: "text-sky-900 dark:text-sky-50",
  },
  danger: {
    box: "border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-100",
    iconWrap: "bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200",
    icon: "alertTriangle",
    titleColor: "text-rose-900 dark:text-rose-50",
  },
  success: {
    box: "border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-100",
    iconWrap: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200",
    icon: "check",
    titleColor: "text-emerald-900 dark:text-emerald-50",
  },
};

export function WarningBox({
  title,
  children,
  tone = "warning",
}: {
  title?: string;
  children: ReactNode;
  tone?: Tone;
}) {
  const t = TONE[tone];
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${t.box}`}>
      <span
        className={`mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg ${t.iconWrap}`}
      >
        <Icon name={t.icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        {title && <div className={`mb-0.5 font-semibold ${t.titleColor}`}>{title}</div>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
