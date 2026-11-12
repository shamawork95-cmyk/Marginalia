/**
 * Opening the PDF and its stored marks, the debounced autosave and its flushes, and the one-time
 * repair of quotes that picked up app menus (moved verbatim from PdfWorkspace).
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { UserSettings } from '../../../types';
import { Annotation } from '../annotationModel';
import { createDebouncedSaver } from '../../../hooks/debouncedSaver';
import { registerUnloadFlush } from '../../../hooks/unloadFlush';
import {
  looksLikeAppChrome,
  quoteFromTextItems,
  repairQuote,
  type PlacedTextItem
} from '../quoteRepair';
import {
  checkpointMarkBackup,
  fetchAnnotations,
  fetchMarkBackups,
  saveAnnotations
} from '../../../utils/documentStorage';
import { PDF_WASM_URL, SAVE_DEBOUNCE_MS } from './docState';

export interface UsePdfDocumentDeps {
  annotations: Annotation[];
  docId: string;
  fileUrl: string;
  isLoaded: boolean;
  pdf: PDFDocumentProxy;
  resetAnnotations: (next: Annotation[]) => void;
  saveState: "idle" | "saving" | "saved";
  setAnnotations: (next: Annotation[] | ((prev: Annotation[]) => Annotation[])) => void;
  setFailure: React.Dispatch<React.SetStateAction<string>>;
  setIsLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  setLoadError: React.Dispatch<React.SetStateAction<string>>;
  setPdf: React.Dispatch<React.SetStateAction<PDFDocumentProxy>>;
  setSaveState: React.Dispatch<React.SetStateAction<"idle" | "saving" | "saved">>;
  settings: UserSettings;
}

export function usePdfDocument(deps: UsePdfDocumentDeps) {
  const { annotations, docId, fileUrl, isLoaded, pdf, resetAnnotations, saveState, setAnnotations, setFailure, setIsLoaded, setLoadError, setPdf, setSaveState, settings } = deps;

  // ── Document ──
  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setLoadError(null);
    const task = getDocument({ url: fileUrl, wasmUrl: PDF_WASM_URL });
    task.promise.then(
      (doc) => {
        if (!cancelled) setPdf(doc);
      },
      (err) => {
        if (cancelled) return;
        console.error('Failed to open PDF:', err);
        setLoadError('This PDF could not be opened. Its original file may not have been stored, or it may be damaged.');
      }
    );
    // Destroying the loading task tears down the worker and the document with it, which is the
    // only teardown pdf.js exposes at this level.
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [fileUrl]);

  // ── Stored marks ──
  useEffect(() => {
    let cancelled = false;
    setIsLoaded(false);
    resetAnnotations([]);
    fetchAnnotations(docId).then((stored) => {
      if (cancelled) return;
      if (!stored) {
        // Deliberately NOT setting `isLoaded`: that flag is what unlocks the autosave, and saving
        // an empty set we never actually read would erase this document's marks from disk. The
        // workspace stays read-only until a real read succeeds.
        setFailure(
          'Could not read this document’s marks, so nothing can be saved. Close the workspace and open it again — your existing marks are untouched on disk.'
        );
        return;
      }
      resetAnnotations((stored.annotations as unknown as Annotation[]) || []);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [docId, resetAnnotations]);

  // ── Persistence ──
  /** Set the first time the reader changes zoom or view mode themselves. */
  const zoomTouchedRef = useRef(false);

  /**
   * The autosave. Paused while a page insert/delete renumbers marks on the server (checked when
   * the timer fires, not only when it is scheduled), flushed before such an operation, and
   * registered for the window-close/reload/quit flush — see `hooks/debouncedSaver`.
   */
  const saver = useMemo(
    () =>
      createDebouncedSaver<Annotation[]>({
        save: (marks) => saveAnnotations(docId, marks as never),
        delayMs: SAVE_DEBOUNCE_MS,
        onResult: (ok) => {
          setSaveState(ok ? 'saved' : 'idle');
          // Never stack: the save retries on every subsequent edit by itself, and one dialog per
          // keystroke would bury the document it is warning about.
          if (!ok) {
            setFailure(
              (current) =>
                current ??
                'Your most recent marks could not be saved to disk, so they exist only in this window. Do not close it until the Saved tick returns — every further change tries again.'
            );
          }
        }
      }),
    [docId]
  );

  useEffect(
    () =>
      registerUnloadFlush(saver, (marks) => ({
        url: `/api/documents/${docId}/annotations`,
        body: JSON.stringify({ annotations: marks })
      })),
    [saver, docId]
  );

  useEffect(() => {
    // Nothing is written until the stored set has been read, or an empty initial state would
    // overwrite the reader's existing marks the moment the document opened.
    if (!isLoaded) return;
    if (!saver.paused()) setSaveState('saving');
    saver.schedule(annotations);
  }, [annotations, isLoaded, saver]);

  // Flush anything still pending when the workspace closes, so marks made in the last moment
  // before navigating away are not lost with the timer. Every load schedules a save and so does
  // every edit (erasing the last mark included), so "pending" covers what the old unconditional
  // write did; a paused saver (marks left pre-renumbering) writes nothing.
  // Then keep a mark backup of this visit (the server skips it when nothing changed).
  useEffect(() => () => void saver.flush().then((ok) => ok && checkpointMarkBackup(docId)), [saver, docId]);

  /**
   * Quotes saved before 2.8.0 that picked up the sidebar and toolbar (see quoteRepair.ts), repaired
   * once per opening: rebuilt from the page's own text under each mark, else stripped, else
   * flagged for review. Only after a backup of the marks as they are is confirmed on disk.
   */
  const quoteRepairDone = useRef<string | null>(null);
  useEffect(() => {
    if (!pdf || !isLoaded || quoteRepairDone.current === docId) return;
    quoteRepairDone.current = docId;
    const suspects = annotations.filter((a) => a.rects?.length && looksLikeAppChrome(a.quote ?? ''));
    if (suspects.length === 0) return;
    let cancelled = false;
    void (async () => {
      await saver.flush();
      await checkpointMarkBackup(docId);
      const [newest] = (await fetchMarkBackups(docId)) ?? [];
      // No backup of the current set, no repair: it waits for the next opening.
      if (!newest || newest.markCount !== annotations.length || cancelled) return;
      const themeNames = settings.activeThemes.map((t) => t.name);
      const patches = new Map<string, Partial<Annotation>>();
      for (const page of [...new Set(suspects.map((a) => a.page))]) {
        let items: PlacedTextItem[] = [];
        try {
          const p = await pdf.getPage(page);
          const vp = p.getViewport({ scale: 1 });
          const content = await p.getTextContent();
          items = content.items.flatMap((it) => {
            if (!('str' in it)) return [];
            const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
            const h = Math.hypot(it.transform[2], it.transform[3]) || it.height;
            return [{ str: it.str, eol: it.hasEOL, box: { x: x / vp.width, y: (y - h) / vp.height, w: it.width / vp.width, h: h / vp.height } }];
          });
        } catch {
          // An unreadable page: its marks fall back to stripping.
        }
        for (const a of suspects.filter((s) => s.page === page)) {
          const fix = repairQuote(a.quote, items.length ? quoteFromTextItems(items, a.rects!) : null, themeNames);
          if (fix) patches.set(a.id, fix);
        }
      }
      if (cancelled || patches.size === 0) return;
      console.info(`[Marginalia] repaired ${patches.size} quote(s) that held app menu text in ${docId}`);
      setAnnotations((prev) => prev.map((a) => (patches.has(a.id) ? { ...a, ...patches.get(a.id) } : a)));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, isLoaded, docId]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = window.setTimeout(() => setSaveState('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  return { saver, zoomTouchedRef };
}
