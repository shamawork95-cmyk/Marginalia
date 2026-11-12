/**
 * The marks archive, shared by the reader and the PDF workspace: Markdown and JSON exports, the
 * commonplace book (.md, .txt, clipboard), "Import marks (JSON)" and "Restore marks" from the
 * rotating backups. Each surface draws its own menu; this hook supplies the actions plus the
 * restore dialog, the hidden file picker and a short status toast (`ui`).
 *
 * Import and restore write the marks on the server, so both run inside `runPageOperation`, the
 * same wrapper page inserts use: pending saves are flushed first, the autosave is paused while the
 * server writes, then the new set is loaded with `reset` (a fresh undo history, so Undo cannot
 * bring the replaced set back).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { History, Loader2, X } from './icons';
import {
  fetchAnnotations,
  fetchClassPack,
  fetchMarkBackups,
  restoreMarkBackup,
  saveAnnotations,
  type Annotation as StoredEntry,
  type MarkBackup
} from '../utils/documentStorage';
import {
  commonplaceMarkdown,
  commonplaceText,
  marksToJson,
  marksToMarkdown,
  mergeImportedMarks,
  parseMarksJson,
  themesToAdd,
  type ExportDocument
} from '../utils/marksExport';
import type { Theme } from '../utils/themes';
import { downloadTextFile } from '../utils/exportAnnotations';
import { runPageOperation, type DebouncedSaver } from '../hooks/debouncedSaver';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { plural } from '../utils/plural';
import { backupTimeLabel, fileStem, importSummary } from './marksArchiveFormat';
import { classPackFilename } from '../utils/classPack';

export interface MarksArchiveOptions {
  /** Absent for a document that was never saved: exports only, no import or backups. */
  docId?: string;
  doc: ExportDocument;
  /** Every stored entry of the document right now. */
  entries: () => StoredEntry[];
  themes: Theme[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saver: DebouncedSaver<any> | null;
  /** Loads a set the server just wrote and resets the undo history. */
  reset: (entries: StoredEntry[]) => void;
  /** Adds themes an import brought along (saved with the settings). */
  onAddThemes: (themes: Theme[]) => void;
  isDark: boolean;
  /** Signs a class pack (the reader's name from Settings). */
  teacher?: string;
}

export interface MarksArchive {
  canImport: boolean;
  exportMarkdown: () => void;
  exportJson: () => void;
  commonplace: (as: 'md' | 'txt' | 'copy') => void;
  importJson: () => void;
  openRestore: () => void;
  /** Saves the document and its marks as one file for students (see utils/classPack). */
  classPack: () => void;
  /** The restore dialog, the file picker and the status toast. Render once. */
  ui: React.ReactNode;
}

const EASE = [0.16, 1, 0.3, 1] as const;

export function useMarksArchive(o: MarksArchiveOptions): MarksArchive {
  const opts = useRef(o);
  opts.current = o;
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 4200);
    return () => window.clearTimeout(t);
  }, [status]);

  const stem = () => fileStem(opts.current.doc.title);
  const exportMarkdown = useCallback(() => {
    const { entries, doc, themes } = opts.current;
    downloadTextFile(marksToMarkdown(entries(), doc, themes), `${stem()} marks.md`, 'text/markdown');
  }, []);
  const exportJson = useCallback(() => {
    const { entries, doc, themes } = opts.current;
    downloadTextFile(marksToJson(entries(), doc, themes), `${stem()} marks.json`, 'application/json');
  }, []);
  const commonplace = useCallback((as: 'md' | 'txt' | 'copy') => {
    const { entries, doc, themes } = opts.current;
    if (as === 'md') return downloadTextFile(commonplaceMarkdown(entries(), doc, themes), `${stem()} commonplace.md`, 'text/markdown');
    const text = commonplaceText(entries(), doc, themes);
    if (as === 'txt') return downloadTextFile(text, `${stem()} commonplace.txt`, 'text/plain');
    void copyText(text).then((ok) => setStatus(ok ? 'Commonplace book copied.' : 'Could not reach the clipboard.'));
  }, []);

  /** Flush, pause, write on the server, re-read, reset. */
  const replaceOnServer = useCallback(async (write: () => Promise<StoredEntry[] | null>, reread: boolean) => {
    const { saver, reset, docId } = opts.current;
    if (!saver || !docId || busy.current) return 'failed' as const;
    busy.current = true;
    try {
      let written: StoredEntry[] | null = null;
      const outcome = await runPageOperation({
        saver,
        operate: async () => (written = await write()),
        reload: async () => (reread ? ((await fetchAnnotations(docId))?.annotations ?? null) : written),
        reset: (entries) => reset(entries as StoredEntry[])
      });
      return outcome.status === 'done' && !outcome.reloaded ? ('unreloaded' as const) : outcome.status;
    } finally {
      busy.current = false;
    }
  }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = parseMarksJson(await file.text());
    if ('error' in parsed) return setStatus(parsed.error);
    let added = 0;
    const result = await replaceOnServer(async () => {
      const { docId, entries } = opts.current;
      const merged = mergeImportedMarks(entries(), parsed.annotations);
      added = merged.added;
      return (await saveAnnotations(docId!, merged.annotations)) ? merged.annotations : null;
    }, true);
    if (result === 'unsaved') return setStatus('Your latest marks could not be saved, so nothing was imported. Try again in a moment.');
    if (result === 'failed') return setStatus('Could not import these marks. Nothing was changed.');
    const newThemes = themesToAdd(opts.current.themes, parsed.themes);
    if (added && newThemes.length) opts.current.onAddThemes(newThemes);
    setStatus(
      result === 'unreloaded'
        ? 'Imported, but the marks could not be re-read. Reopen this document before marking anything else.'
        : importSummary(added, added ? newThemes.length : 0)
    );
  };

  const restore = async (backup: MarkBackup) => {
    const result = await replaceOnServer(() => restoreMarkBackup(opts.current.docId!, backup.id), false);
    if (result === 'unsaved') return 'Your latest marks could not be saved, so nothing was restored. Try again in a moment.';
    if (result === 'failed' || result === 'unreloaded') return 'Could not restore that backup. Your marks were left as they were.';
    setRestoreOpen(false);
    setStatus(`Restored ${plural(backup.markCount, 'mark')} from ${backupTimeLabel(backup.savedAt)}.`);
    return null;
  };

  const classPack = async () => {
    const { docId, saver, doc, teacher } = opts.current;
    if (!docId) return;
    // The pack is read from disk, so the latest marks are written first.
    if (saver && !(await saver.flush())) return setStatus('Your latest marks could not be saved yet, so no class pack was made. Try again in a moment.');
    const body = await fetchClassPack(docId, teacher ?? '', '');
    if (!body) return setStatus('The class pack could not be made.');
    downloadTextFile(body, classPackFilename(doc.title), 'application/json');
    setStatus('Class pack saved. Students open it from Add Document, with no account or internet.');
  };

  const canImport = !!o.docId && !!o.saver;
  const ui = (
    <>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onFile(e)} tabIndex={-1} aria-hidden />
      <RestoreDialog
        open={restoreOpen}
        docId={o.docId}
        markCount={o.entries().length}
        onRestore={restore}
        onClose={() => setRestoreOpen(false)}
      />
      <AnimatePresence>
        {status && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="fixed z-[70] bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 max-w-[calc(100vw-32px)] w-max px-4 py-2.5 rounded-2xl shadow-2xl text-[12.5px] ink-card bg-white text-stone-800 border border-stone-200 dark:bg-night-3 dark:text-paper dark:border-stone-700"
          >
            {status}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return {
    canImport,
    exportMarkdown,
    exportJson,
    commonplace,
    importJson: () => canImport && fileRef.current?.click(),
    openRestore: () => canImport && setRestoreOpen(true),
    classPack: () => void classPack(),
    ui
  };
}

/** "Restore marks": the document's backups, newest first, each with its time and mark count. */
const RestoreDialog: React.FC<{
  open: boolean;
  docId?: string;
  markCount: number;
  onRestore: (b: MarkBackup) => Promise<string | null>;
  onClose: () => void;
}> = ({ open, docId, markCount, onRestore, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [backups, setBackups] = useState<MarkBackup[] | null | 'loading'>('loading');
  const [picked, setPicked] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogFocus(ref, open, () => !working && onClose());

  useEffect(() => {
    if (!open || !docId) return;
    let cancelled = false;
    setBackups('loading');
    setPicked(null);
    setError(null);
    void fetchMarkBackups(docId).then((list) => {
      if (!cancelled) setBackups(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open, docId]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
  }, [open, backups]);

  const chosen = Array.isArray(backups) ? backups.find((b) => b.id === picked) : undefined;
  const run = async () => {
    if (!chosen) return;
    setWorking(true);
    setError(await onRestore(chosen));
    setWorking(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/50 backdrop-blur-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE }}
          onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-marks-title"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="ink-card w-full max-w-md rounded-3xl p-5 shadow-2xl border space-y-4 bg-white border-stone-200 text-stone-900 dark:bg-night-3 dark:border-stone-700 dark:text-paper"
          >
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center bg-gold/10 text-gold">
                <History className="w-4.5 h-4.5" />
              </span>
              <div className="flex-1 min-w-0">
                <h2 id="restore-marks-title" className="title-hand text-[26px] leading-tight">
                  Restore marks
                </h2>
                <p className="text-[12.5px] text-muted leading-relaxed">
                  Pick a saved copy. Your current {plural(markCount, 'mark')} become a backup first, so you can come back to them.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={working}
                aria-label="Close"
                className="w-8 h-8 -mr-1 -mt-1 rounded-full flex items-center justify-center text-muted hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {backups === 'loading' ? (
              <p className="flex items-center gap-2 text-[12.5px] text-muted py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Reading backups…
              </p>
            ) : backups === null ? (
              <p className="text-[12.5px] text-muted py-3">The backups could not be read. Close this and try again.</p>
            ) : backups.length === 0 ? (
              <p className="text-[12.5px] text-muted py-3">
                No backups yet. One is kept when you leave a document after changing its marks, at most every ten minutes.
              </p>
            ) : (
              <ul role="radiogroup" aria-label="Backups" className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
                {backups.map((b, i) => {
                  const on = picked === b.id;
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        data-autofocus={i === 0 ? '' : undefined}
                        onClick={() => setPicked(b.id)}
                        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl text-left border transition-colors cursor-pointer ${
                          on
                            ? 'border-gold bg-gold/10'
                            : 'border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-nav-hover'
                        }`}
                      >
                        <span className="text-[13px] font-medium">{backupTimeLabel(b.savedAt) || 'Unknown time'}</span>
                        <span className="text-[12px] text-muted tabular-nums">{plural(b.markCount, 'mark')}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {error && (
              <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={working}
                className="px-4 py-2 rounded-full caps text-[12.5px] text-muted hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={!chosen || working}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full caps text-[12.5px] bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Restore
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/** One row of the archive: what it is, then its actions as small pills. */
export interface ArchiveRow {
  title: string;
  sub: string;
  actions: { label: string; onSelect: () => void; disabled?: boolean; hint?: string }[];
}

export function archiveRows(a: MarksArchive, markCount: number): ArchiveRow[] {
  const none = markCount === 0;
  const noStore = a.canImport ? undefined : 'Only for documents saved in My Collections';
  return [
    {
      title: 'Commonplace book',
      sub: 'Your marks gathered by theme, each quoted with its page or paragraph, ready for an essay.',
      actions: [
        { label: 'Save .md', onSelect: () => a.commonplace('md'), disabled: none },
        { label: 'Save .txt', onSelect: () => a.commonplace('txt'), disabled: none },
        { label: 'Copy', onSelect: () => a.commonplace('copy'), disabled: none }
      ]
    },
    {
      title: 'Full record',
      sub: 'Every mark with its place, theme, colour, note and dates. JSON can be imported again.',
      actions: [
        { label: 'Markdown', onSelect: a.exportMarkdown, disabled: none },
        { label: 'JSON', onSelect: a.exportJson, disabled: none }
      ]
    },
    {
      title: 'Class pack',
      sub: 'This document with your marks as one file for students, shared by USB stick or folder. No accounts, no internet.',
      actions: [{ label: 'Save class pack', onSelect: a.classPack, disabled: !a.canImport, hint: noStore }]
    },
    {
      title: 'Bring marks back',
      sub: 'Add marks from a JSON export, or return to an earlier saved copy of this document’s marks.',
      actions: [
        { label: 'Import marks (JSON)', onSelect: a.importJson, disabled: !a.canImport, hint: noStore },
        { label: 'Restore marks…', onSelect: a.openRestore, disabled: !a.canImport, hint: noStore }
      ]
    }
  ];
}

/** The rows in one card, divided; `compact` for the PDF toolbar's menu. */
export const ArchivePanel: React.FC<{ rows: ArchiveRow[]; compact?: boolean; onAction?: () => void }> = ({ rows, compact, onAction }) => (
  <div className={`divide-y divide-stone-200 dark:divide-stone-700/70 ${compact ? '' : 'rounded-2xl border border-stone-200 dark:border-stone-700'}`}>
    {rows.map((row) => (
      <div key={row.title} className={`flex flex-col gap-2 ${compact ? 'px-3 py-2.5' : 'p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4'}`}>
        <div className="min-w-0">
          <div className="font-bold text-[13px] text-stone-900 dark:text-paper">{row.title}</div>
          <div className={`text-[11.5px] text-muted leading-snug ${compact ? 'max-w-[18rem]' : 'max-w-md'}`}>{row.sub}</div>
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {row.actions.map((act) => (
            <button
              key={act.label}
              type="button"
              disabled={act.disabled}
              title={act.disabled ? act.hint : undefined}
              onClick={() => {
                act.onSelect();
                onAction?.();
              }}
              className="rounded-full caps caps-sm px-3 py-1.5 border border-stone-300 dark:border-stone-600 text-stone-800 dark:text-paper hover:border-gold hover:bg-gold/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-stone-300 dark:disabled:hover:border-stone-600"
            >
              {act.label}
            </button>
          ))}
        </div>
      </div>
    ))}
  </div>
);

/** Writes text to the clipboard; false when the clipboard refused. */
export function copyText(text: string): Promise<boolean> {
  // The async clipboard refuses an unfocused document; the older copy command still works there.
  const fallback = () => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    const sel = window.getSelection();
    const kept = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const focused = document.activeElement as HTMLElement | null;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    focused?.focus({ preventScroll: true });
    if (kept && sel) {
      sel.removeAllRanges();
      sel.addRange(kept);
    }
    return ok;
  };
  if (!navigator.clipboard?.writeText) return Promise.resolve(fallback());
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => fallback()
  );
}

/** A mark's words shortened for a one-line list. */
export function excerpt(text: string, max = 60): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}
