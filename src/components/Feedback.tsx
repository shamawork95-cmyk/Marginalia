/**
 * "Send feedback": the sidebar item and the occasional prompt (from the 5th launch; "Not now"
 * brings it back 15 launches on, "Don't ask again" ends it; kept in the main-process config.json).
 * Both open a small dialog: a link to the feedback form (FEEDBACK_URL, a Google Form, opened in
 * the reader's own browser) and the email address as selectable text. Marginalia sends nothing
 * itself.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Feedback as FeedbackIcon, X } from './icons';
import { answerFeedbackPrompt, desktopBridge, getFeedbackDue } from '../utils/documentStorage';
import { FEEDBACK_EMAIL, feedbackFormUrl, feedbackMailto } from '../utils/feedback';
import { CURRENT_APP_VERSION } from '../data/changelog';
import { useDialogFocus } from '../hooks/useDialogFocus';

const OPEN_EVENT = 'marginalia:open-feedback';

/** Opens the Send feedback dialog (from the sidebar, the drawer or the prompt). */
export function openFeedback(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The dialog, mounted once in App; opened by `openFeedback()`. */
export const FeedbackDialog: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = () => {
      setCopied(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  const close = () => setOpen(false);
  useDialogFocus(ref, open, close);
  if (!open) return null;
  const form = feedbackFormUrl();
  const secondary = `px-4 py-2 rounded-full caps text-[12px] border cursor-pointer inline-flex items-center gap-1.5 ${
    isDark ? 'border-stone-700 hover:bg-nav-hover' : 'border-stone-300 hover:bg-stone-100'
  }`;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className={`ink-card w-[min(28rem,100%)] rounded-2xl border p-5 shadow-2xl ${
          isDark ? 'bg-night-3 border-stone-700 text-paper' : 'bg-white border-stone-200 text-stone-900'
        }`}
      >
        <div className="flex items-start gap-3">
          <FeedbackIcon className="w-5 h-5 text-gold shrink-0 mt-1.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <h2 id="feedback-dialog-title" className="title-hand text-[24px] leading-tight">
              Send feedback
            </h2>
            <p className="text-[13.5px] leading-relaxed">
              What helps, what gets in the way, what you would like next: a line or two shapes the next version.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="p-1 -m-1 rounded-lg text-muted hover:text-stone-900 dark:hover:text-paper cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {form && (
          <div className="mt-4 space-y-2">
            <button
              type="button"
              autoFocus
              onClick={() => {
                // The shell opens https links in the reader's own browser (main.cjs).
                window.open(form, '_blank', 'noopener');
                void answerFeedbackPrompt('sent');
                close();
              }}
              className="w-full px-4 py-2.5 rounded-full caps text-[12px] bg-accent hover:bg-accent-hover text-on-accent cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              Open the feedback form
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <p className="text-[12px] text-muted leading-snug">
              The form is hosted by Google (Google Forms) and opens in your browser. What you write there goes to Google and to the
              Marginalia team. Marginalia itself sends nothing.
            </p>
          </div>
        )}

        <div className={`${form ? 'mt-4 pt-4 border-t border-stone-200 dark:border-stone-700/70' : 'mt-4'} space-y-2`}>
          <p className="text-[12.5px] text-muted">{form ? 'Or write to us:' : 'Write to us:'}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="select-all font-mono text-[13px] px-2 py-1 rounded-md bg-stone-100 dark:bg-night-1">{FEEDBACK_EMAIL}</span>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard?.writeText(FEEDBACK_EMAIL).then(
                  () => setCopied(true),
                  () => setCopied(false)
                )
              }
              className={secondary}
              aria-label="Copy the email address"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-gold" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              autoFocus={!form}
              onClick={() => {
                void sendFeedback();
                close();
              }}
              className={secondary}
            >
              Write an email
            </button>
          </div>
          {copied && (
            <span role="status" className="sr-only">
              Email address copied
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/** Opens the feedback email and records that it was sent, so the prompt stops. */
export async function sendFeedback(): Promise<void> {
  let platform: string | undefined;
  try {
    platform = (await desktopBridge()?.getAppInfo())?.platform;
  } catch {
    /* the email simply says less */
  }
  // The shell's window-open handler hands this one address, and no other mailto:, to the mail app (main.cjs).
  window.open(feedbackMailto({ version: CURRENT_APP_VERSION, platform }), '_blank', 'noopener');
  void answerFeedbackPrompt('sent');
}

/**
 * The prompt: a small card at the bottom corner, never over a reading screen's first seconds
 * (shown 20 s after launch) and never while another dialog is open.
 */
export const FeedbackPrompt: React.FC<{ blocked: boolean; isDark: boolean }> = ({ blocked, isDark }) => {
  const [due, setDue] = useState(false);
  const [ready, setReady] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    void getFeedbackDue().then((d) => live && setDue(d));
    const t = window.setTimeout(() => live && setReady(true), 20_000);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, []);
  const open = due && ready && !blocked;
  useEffect(() => {
    if (open) firstRef.current?.focus({ preventScroll: true });
  }, [open]);
  if (!open) return null;

  const answer = (a: 'later' | 'never') => {
    setDue(false);
    void answerFeedbackPrompt(a);
  };
  return (
    <div
      role="dialog"
      aria-labelledby="feedback-prompt-title"
      className={`ink-card fixed z-[55] bottom-4 right-4 max-md:bottom-[calc(5rem+env(safe-area-inset-bottom))] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border p-4 shadow-2xl motion-safe:animate-[panel-in_220ms_var(--ease-out)] ${
        isDark ? 'bg-night-3 border-stone-700 text-paper' : 'bg-white border-stone-200 text-stone-900'
      }`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') answer('later');
      }}
    >
      <div className="flex items-start gap-3">
        <FeedbackIcon className="w-5 h-5 text-gold shrink-0 mt-1" />
        <div className="flex-1 min-w-0 space-y-1">
          <h2 id="feedback-prompt-title" className="title-hand text-[22px] leading-tight">
            How is Marginalia working for you?
          </h2>
          <p className="text-[13px] text-muted leading-snug">
            A line or two about what helps and what gets in the way shapes the next version.
          </p>
        </div>
        <button type="button" onClick={() => answer('later')} aria-label="Not now" className="p-1 -m-1 rounded-lg text-muted hover:text-stone-900 dark:hover:text-paper cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => answer('never')} className="text-[12px] text-muted hover:underline cursor-pointer mr-auto">
          Don’t ask again
        </button>
        <button
          type="button"
          onClick={() => answer('later')}
          className={`px-4 py-2 rounded-full caps text-[12px] border cursor-pointer ${isDark ? 'border-stone-700 hover:bg-nav-hover' : 'border-stone-300 hover:bg-stone-100'}`}
        >
          Not now
        </button>
        <button
          ref={firstRef}
          type="button"
          onClick={() => {
            setDue(false);
            // Answered: the prompt does not come back, whatever is then sent from the dialog.
            void answerFeedbackPrompt('sent');
            openFeedback();
          }}
          className="px-4 py-2 rounded-full caps text-[12px] bg-accent hover:bg-accent-hover text-on-accent cursor-pointer"
        >
          Send feedback
        </button>
      </div>
    </div>
  );
};
