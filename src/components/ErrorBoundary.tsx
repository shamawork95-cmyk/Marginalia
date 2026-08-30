import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Returns to a known-good screen instead of reloading the whole app. */
  onGoHome?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches rendering errors so one broken screen cannot take the whole app down.
 *
 * The `@ts-ignore` comments and `(this as any)` casts this class used to carry were not
 * necessary — they were papering over the fact that `@types/react` was missing from the project,
 * which left `Component` untyped. With the types installed the class checks normally.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React Error caught by ErrorBoundary:', error, errorInfo);
  }

  private reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-[#f9f9f7] dark:bg-[#121514] text-stone-900 dark:text-stone-100">
        <div className="max-w-md w-full p-6 rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xl text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-serif text-[20px] font-bold">Something went wrong</h3>
            <p className="text-[13px] text-stone-500 dark:text-stone-400 mt-1">
              This screen ran into an unexpected problem. Your documents and annotations are safe
              on disk — nothing was lost.
            </p>
            {/* The message itself, because a desktop user has no developer console to open. */}
            {this.state.error?.message && (
              <p className="mt-2 text-[11px] font-mono text-stone-400 dark:text-stone-500 break-words">
                {this.state.error.message}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={this.reset}
              className="flex-1 py-2.5 px-4 rounded-xl bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 text-[13px] font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Try Again</span>
            </button>
            <button
              type="button"
              onClick={() => {
                this.reset();
                // Prefer the in-app navigator. `window.location` still works as a fallback, but
                // in the desktop app a hard document load throws away all unsaved screen state.
                this.props.onGoHome?.();
              }}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[#435c52] hover:bg-[#374c43] text-white text-[13px] font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Home className="w-4 h-4" />
              <span>Go Home</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
