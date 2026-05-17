import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export type ConfirmResult = "confirm" | "cancel" | "tertiary";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * Optional third button. When set, a third action surfaces between cancel
   * and confirm. The caller receives "tertiary" instead of boolean true/false.
   * Use `useConfirmExtended` to read the tri-state result.
   */
  tertiaryLabel?: string;
}

type Resolver = (value: ConfirmResult) => void;

interface PendingConfirm extends ConfirmOptions {
  resolve: Resolver;
}

const ConfirmContext = createContext<
  ((opts: ConfirmOptions) => Promise<ConfirmResult>) | null
>(null);

/**
 * Imperative confirmation modal. Replaces native window.confirm() so we get
 * branded styling, dark mode, focus trap, ESC/Enter handling, and a destructive
 * variant. Usage:
 *
 *   const askConfirm = useConfirm();
 *   if (!(await askConfirm({ title: "Delete ticket?", destructive: true }))) return;
 */
/**
 * Boolean alias kept for the existing binary call sites. Maps any result
 * other than "confirm" (including the tertiary button if one was shown)
 * to false. New code that needs the tri-state value should call
 * `useConfirmExtended` directly.
 */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm() must be used inside <ConfirmProvider>.");
  }
  return useCallback(
    (opts: ConfirmOptions) => ctx(opts).then((r) => r === "confirm"),
    [ctx],
  );
}

/** Tri-state variant. Returns the literal "confirm" / "cancel" / "tertiary". */
export function useConfirmExtended(): (opts: ConfirmOptions) => Promise<ConfirmResult> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirmExtended() must be used inside <ConfirmProvider>.");
  }
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const ask = useCallback((opts: ConfirmOptions) => {
    return new Promise<ConfirmResult>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback(
    (result: ConfirmResult) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && <ConfirmDialog options={pending} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  options,
  onClose,
}: {
  options: ConfirmOptions;
  onClose: (result: ConfirmResult) => void;
}) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const tertiaryBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    confirmBtnRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose("cancel");
      } else if (e.key === "Enter") {
        if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
        e.preventDefault();
        onClose("confirm");
      } else if (e.key === "Tab") {
        const els = [
          cancelBtnRef.current,
          tertiaryBtnRef.current,
          confirmBtnRef.current,
        ].filter(Boolean) as HTMLElement[];
        if (els.length === 0) return;
        const active = document.activeElement as HTMLElement | null;
        const idx = active ? els.indexOf(active) : -1;
        e.preventDefault();
        const next = e.shiftKey
          ? els[(idx - 1 + els.length) % els.length]
          : els[(idx + 1) % els.length];
        next.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tone = options.destructive
    ? {
        accent:
          "bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300",
        confirmClass: "btn-danger",
      }
    : {
        accent:
          "bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-200",
        confirmClass: "btn-primary",
      };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm motion-safe:animate-[fadeIn_120ms_ease-out]"
        onClick={() => onClose("cancel")}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xl shadow-slate-900/30 motion-safe:animate-[scaleIn_140ms_ease-out] dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl ${tone.accent}`}
          >
            <Icon
              name={options.destructive ? "alertTriangle" : "info"}
              className="h-4 w-4"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="confirm-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-50"
            >
              {options.title}
            </h2>
            {options.message && (
              <div className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {options.message}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelBtnRef}
            type="button"
            className="btn-ghost"
            onClick={() => onClose("cancel")}
          >
            {options.cancelLabel ?? "Cancel"}
          </button>
          {options.tertiaryLabel && (
            <button
              ref={tertiaryBtnRef}
              type="button"
              className="btn-secondary"
              onClick={() => onClose("tertiary")}
            >
              {options.tertiaryLabel}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={tone.confirmClass}
            onClick={() => onClose("confirm")}
          >
            {options.confirmLabel ?? (options.destructive ? "Delete" : "Confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
