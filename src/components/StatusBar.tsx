import { useEffect } from "react";
import { useAppStore } from "../services/appStore";

export function StatusBar() {
  const status = useAppStore((s) => s.status);
  const setStatus = useAppStore((s) => s.setStatus);

  useEffect(() => {
    if (!status || status.kind === "error") return;
    const t = setTimeout(() => setStatus(null), 3500);
    return () => clearTimeout(t);
  }, [status, setStatus]);

  if (!status) {
    return (
      <div className="flex items-center justify-between border-t border-slate-200/80 bg-white/70 px-5 py-2 text-[11px] text-slate-500 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/60">
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Local-only · No data leaves this machine.
        </span>
        <span className="font-mono uppercase tracking-wider opacity-70">Ready</span>
      </div>
    );
  }

  const kindStyle: Record<string, { bg: string; dot: string; ring: string }> = {
    success: {
      bg: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
      dot: "bg-emerald-500",
      ring: "border-emerald-200 dark:border-emerald-800/60",
    },
    warning: {
      bg: "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100",
      dot: "bg-amber-500",
      ring: "border-amber-200 dark:border-amber-800/60",
    },
    error: {
      bg: "bg-rose-50 text-rose-900 dark:bg-rose-950/60 dark:text-rose-100",
      dot: "bg-rose-500",
      ring: "border-rose-200 dark:border-rose-800/60",
    },
    info: {
      bg: "bg-slate-100 text-slate-800 dark:bg-slate-800/80 dark:text-slate-100",
      dot: "bg-slate-500",
      ring: "border-slate-200 dark:border-slate-700",
    },
  };
  const style = kindStyle[status.kind] ?? kindStyle.info;

  return (
    <div className={`flex items-center justify-between border-t px-5 py-2 text-xs ${style.bg} ${style.ring}`}>
      <span className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
        {status.message}
      </span>
      <button
        onClick={() => setStatus(null)}
        className="rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M5.7 4.3a1 1 0 011.4 0L10 7.2l2.9-2.9a1 1 0 111.4 1.4L11.4 8.6l2.9 2.9a1 1 0 01-1.4 1.4L10 10l-2.9 2.9a1 1 0 01-1.4-1.4l2.9-2.9-2.9-2.9a1 1 0 010-1.4z" />
        </svg>
      </button>
    </div>
  );
}
