import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Friendly message shown when an error is caught. */
  fallbackTitle?: string;
  /** Subtext under the title. */
  fallbackHint?: string;
  /** Label for the retry button. Defaults to "Try Again". */
  retryLabel?: string;
  /**
   * Optional callback invoked when the user clicks Retry. Use this to clear
   * cached state, refetch data, etc. The boundary will reset its own error
   * state regardless.
   */
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions in its subtree and shows a friendly error
 * card with a Retry button instead of a blank screen. The rest of the app
 * keeps running because the boundary scopes the failure to this subtree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local-only logging — no telemetry leaves the machine.
    console.error("ErrorBoundary caught:", error, info?.componentStack);
  }

  handleRetry = (): void => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    const title = this.props.fallbackTitle ?? "This page could not load.";
    const hint =
      this.props.fallbackHint ??
      "The rest of the app is still available. You can try again, or come back to this view later.";
    const retryLabel = this.props.retryLabel ?? "Try Again";

    return (
      <div className="mx-auto max-w-3xl">
        <div className="card space-y-3 border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30">
          <h2 className="text-base font-semibold text-red-900 dark:text-red-200">
            {title}
          </h2>
          <p className="text-sm text-red-800/90 dark:text-red-200/90">{hint}</p>
          <details className="text-xs text-red-900/80 dark:text-red-200/80">
            <summary className="cursor-pointer">Show technical details</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-100 p-2 dark:bg-red-900/30">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </details>
          <div>
            <button className="btn-primary" onClick={this.handleRetry}>
              {retryLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
