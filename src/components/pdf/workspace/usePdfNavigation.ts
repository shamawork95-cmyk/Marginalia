/**
 * Navigation and zoom: the book view and its page turns, keys and swipe, going to a page, restoring
 * the reading position, fit width, pages in view and wheel zoom (moved verbatim from PdfWorkspace).
 */

import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { type PDFDocumentProxy } from 'pdfjs-dist';
import { useReducedMotion } from 'motion/react';
import { playTurn, snapshotPage, turnDirection, type PageBox } from '../../pageTurn';
import { isTypingTarget } from '../workspaceKeys';
import { useSwipeTurn } from '../../swipeTurn';
import {
  fetchReadingState,
  saveReadingState,
  ReadingState,
  type PdfViewMode
} from '../../../utils/documentStorage';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_BOOK_WIDTH,
  MIN_ZOOM,
  SAVE_DEBOUNCE_MS,
  StoredDocState,
  loadDocState,
  saveDocState
} from './docState';

export interface UsePdfNavigationDeps {
  currentPage: number;
  docId: string;
  fittedRef: React.RefObject<string>;
  jumpToPage: number;
  pageCount: number;
  pdf: PDFDocumentProxy;
  restoredPageRef: React.RefObject<string>;
  resumeReading: boolean;
  scale: number;
  scrollRef: React.RefObject<HTMLDivElement>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  setLayoutSettled: React.Dispatch<React.SetStateAction<boolean>>;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  setViewMode: React.Dispatch<React.SetStateAction<PdfViewMode>>;
  viewMode: PdfViewMode;
  zoomTouchedRef: React.RefObject<boolean>;
}

export function usePdfNavigation(deps: UsePdfNavigationDeps) {
  const { currentPage, docId, fittedRef, jumpToPage, pageCount, pdf, restoredPageRef, resumeReading, scale, scrollRef, setCurrentPage, setLayoutSettled, setScale, setViewMode, viewMode, zoomTouchedRef } = deps;

  // ── Navigation & zoom ──
  /**
   * The spread as a book: only the open pair is drawn, and moving to another pair turns a leaf
   * (`pageTurn.ts`). Narrower than two readable pages, spread view keeps its old scrolling pairs.
   */
  const reduceMotion = useReducedMotion();
  const [areaWidth, setAreaWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setAreaWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [pdf]);
  const bookOn = viewMode === 'spread' && areaWidth >= MIN_BOOK_WIDTH;
  const bookRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<{ finish: () => void } | null>(null);
  useEffect(() => () => turnRef.current?.finish(), []);
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;
  const turnToPage = (page: number, animate: boolean) => {
    const from = Math.floor((pageRef.current - 1) / 2);
    const to = Math.floor((page - 1) / 2);
    const dir = turnDirection(from, to);
    pageRef.current = page;
    setCurrentPage(page);
    const book = bookRef.current;
    if (!dir || !book || !animate) return;
    turnRef.current?.finish();
    const origin = book.getBoundingClientRect();
    const pageEl = (n: number) => book.querySelector<HTMLElement>(`[data-page-number="${n}"]`);
    const boxOf = (el: HTMLElement): PageBox => {
      const r = el.getBoundingClientRect();
      return { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
    };
    const L = pageEl(2 * from + 1);
    const R = pageEl(2 * from + 2);
    if (!L) return;
    const left = boxOf(L);
    const right = R ? boxOf(R) : { ...left, left: left.left + left.width };
    const t = playTurn({
      layer: book,
      left,
      right,
      dir,
      front: (dir === 1 ? R : L) ? snapshotPage((dir === 1 ? R : L)!) : null,
      cover: (dir === 1 ? L : R) ? snapshotPage((dir === 1 ? L : R)!) : null,
      back: () => {
        const el = pageEl(dir === 1 ? 2 * to + 1 : 2 * to + 2);
        if (!el) return null;
        const copy = snapshotPage(el);
        // Drawn offstage until now: the copy takes the face's place, not the offstage spot.
        for (const p of ['position', 'left', 'top', 'visibility', 'pointer-events']) copy.style.removeProperty(p);
        return copy;
      },
      reduced: Boolean(reduceMotion)
    });
    turnRef.current = t;
  };
  const bookTurnRef = useRef<((page: number, animate: boolean) => void) | null>(null);
  bookTurnRef.current = bookOn ? turnToPage : null;

  // Arrow keys and Page Up / Down turn the book; never while typing or in a dialog.
  useEffect(() => {
    if (!bookOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const step = e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const pair = Math.floor((pageRef.current - 1) / 2) + step;
      const page = Math.min(pageCount, Math.max(1, pair * 2 + 1));
      if (page !== pageRef.current) bookTurnRef.current?.(page, true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bookOn, pageCount]);

  // A sideways swipe (finger, pen, trackpad) turns the book too.
  const swipeTurn = useCallback(
    (step: 1 | -1) => {
      const pair = Math.floor((pageRef.current - 1) / 2) + step;
      const page = Math.min(pageCount, Math.max(1, pair * 2 + 1));
      if (page !== pageRef.current) bookTurnRef.current?.(page, true);
    },
    [pageCount]
  );
  useSwipeTurn(scrollRef, swipeTurn, bookOn);

  const goToPage = useCallback((page: number, animate = true) => {
    if (bookTurnRef.current) return bookTurnRef.current(page, animate);
    scrollRef.current
      ?.querySelector(`[data-page-number="${page}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrentPage(page);
  }, []);

  /**
   * Opens a document at 125% zoom — the size most letter/A4-ish pages read comfortably at —
   * unless a zoom was already remembered for this document, in which case that wins.
   *
   * The 125% default is clamped by a fit-to-width fallback for pages whose own geometry makes it
   * a bad fit: an Urdu collection scanned at 122x173 points once came out as postage stamps three
   * fingers wide at a fixed zoom, unreadable and impossible to annotate, and an oversized page box
   * would just as wrongly spill far past the viewer. Fitting the width in either of those cases
   * makes the page as large as there is room for, given its own dimensions. Done once per
   * document, so a zoom the reader sets afterwards is never overridden.
   */
  useEffect(() => {
    if (!pdf || fittedRef.current === docId) return;
    const container = scrollRef.current;
    if (!container || container.clientWidth === 0) return;

    const stored = loadDocState(docId);
    if (stored) {
      fittedRef.current = docId;
      setScale(stored.scale);
      setViewMode(stored.viewMode);
      setLayoutSettled(true);
      return;
    }

    let cancelled = false;
    void pdf.getPage(1).then((page) => {
      if (cancelled) return;
      const unscaled = page.getViewport({ scale: 1 });
      const fit = (container.clientWidth - 48) / unscaled.width;
      const renderedAtDefault = unscaled.width * DEFAULT_ZOOM;
      const badFit = renderedAtDefault < container.clientWidth * 0.5 || renderedAtDefault > container.clientWidth * 2.5;
      fittedRef.current = docId;
      setScale(badFit ? Math.max(0.5, Math.min(3, fit)) : DEFAULT_ZOOM);
      setLayoutSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, docId]);

  /** Restores the page the reader was last on, once per document, after that zoom is settled. */
  useEffect(() => {
    if (!pdf || pageCount === 0 || restoredPageRef.current === docId) return;
    restoredPageRef.current = docId;
    if (jumpToPage && jumpToPage >= 1 && jumpToPage <= pageCount) {
      requestAnimationFrame(() => goToPage(jumpToPage, false));
      return;
    }
    if (!resumeReading) return;
    const stored = loadDocState(docId);
    if (stored && stored.page > 1 && stored.page <= pageCount) {
      // The page elements render synchronously off `pageCount`, but a frame gives layout a
      // moment to settle before `scrollIntoView` measures it.
      requestAnimationFrame(() => goToPage(stored.page, false));
    }
  }, [pdf, pageCount, docId, goToPage, resumeReading, jumpToPage]);

  /**
   * Fetches the server's saved reading position once per document — the durable copy, since it
   * lives outside the browser's localStorage (see `ReadingState`'s doc comment). Applied by the
   * effect below once the page count is known, so an out-of-range page can be validated exactly
   * as the local restore effect above already does.
   */
  const [remoteReadingState, setRemoteReadingState] = useState<ReadingState | null>(null);
  const fetchedReadingStateFor = useRef<string | null>(null);
  useEffect(() => {
    if (!docId || fetchedReadingStateFor.current === docId) return;
    fetchedReadingStateFor.current = docId;
    setRemoteReadingState(null);
    void fetchReadingState(docId).then(setRemoteReadingState);
  }, [docId]);

  const appliedReadingStateFor = useRef<string | null>(null);
  useEffect(() => {
    if (!remoteReadingState || !docId || pageCount === 0 || appliedReadingStateFor.current === docId) return;
    appliedReadingStateFor.current = docId;
    fittedRef.current = docId;
    restoredPageRef.current = docId;
    // Not applied over a zoom the reader set while the fetch was in flight — pressing Zoom In
    // twice on open used to snap back to the stored value when the response landed.
    if (!zoomTouchedRef.current) {
      setScale(remoteReadingState.scale);
      setViewMode(remoteReadingState.viewMode);
    }
    setLayoutSettled(true);
    if (resumeReading && remoteReadingState.page > 1 && remoteReadingState.page <= pageCount) {
      requestAnimationFrame(() => goToPage(remoteReadingState.page, false));
    }
    // The stored position is left as it is on a fresh open — the reader has not moved yet, and
    // overwriting page 1 over it here would destroy the very position Continue annotating needs.
    if (resumeReading) saveDocState(docId, remoteReadingState);
  }, [remoteReadingState, pageCount, docId, goToPage, resumeReading]);

  /**
   * Remembers this document's zoom, page and view mode so reopening it resumes where the reader
   * left off — to localStorage immediately (fast, same-session cache) and to the server,
   * debounced, so scrolling through a book doesn't fire a write on every frame.
   */
  /** Set the moment a fresh open actually leaves page one. See the save effect below. */
  const movedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current !== docId) return;
    if (currentPage > 1) movedRef.current = true;

    // A fresh open sits on page one having read nothing, so writing that as the position would
    // erase wherever the reader actually stopped last time — the position Continue annotating
    // exists to return to. Zoom and view mode are still recorded, since changing those IS an
    // action the reader just took.
    const keepStoredPage = !resumeReading && !movedRef.current;
    const state: StoredDocState = {
      scale,
      page: keepStoredPage ? (loadDocState(docId)?.page ?? currentPage) : currentPage,
      viewMode
    };
    saveDocState(docId, state);
    const timer = setTimeout(() => { void saveReadingState(docId, state); }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [scale, currentPage, viewMode, docId, resumeReading]);

  const fitWidth = useCallback(async () => {
    if (!pdf || !scrollRef.current) return;
    const page = await pdf.getPage(currentPage);
    const unscaled = page.getViewport({ scale: 1 });
    setScale(Math.max(0.25, Math.min(5, (scrollRef.current.clientWidth - 48) / unscaled.width)));
  }, [pdf, currentPage]);

  /** The row gap between two pages in a spread — matches the `gap-5` (1.25rem) the layout below uses. */
  const SPREAD_GAP_PX = 20;


  /**
   * Switching to spread view without also shrinking the zoom left two full-width pages competing
   * for the window's width — they simply wrapped onto separate lines via `flex-wrap`, so the
   * layout looked unchanged and the toggle read as broken. Real two-page views solve this the
   * same way "Fit to width" already solves the one-page case: compute a scale two pages plus the
   * gap between them actually fit at, and apply it the moment the mode is switched on.
   */
  const handleViewModeChange = useCallback(
    (mode: PdfViewMode) => {
      zoomTouchedRef.current = true;
      setViewMode(mode);
      if (!pdf || !scrollRef.current) return;
      const container = scrollRef.current;
      void pdf.getPage(currentPage).then((page) => {
        const unscaled = page.getViewport({ scale: 1 });
        // Spread halves the width each page gets, so it refits to two-up. Going back refits to
        // one — without that the document stayed at the shrunken spread zoom, half the size of
        // the window, and the reader had to zoom back by hand.
        const usable = container.clientWidth - 48;
        // The book shows one pair at a time, so the pair fits the height too (40: the area's padding).
        // A grid fits its columns across and its two rows down, so the whole set is in view.
        const cols = mode === 'grid6' ? 3 : mode === 'grid4' || mode === 'spread' ? 2 : 1;
        const rows = mode === 'grid4' || mode === 'grid6' ? 2 : 1;
        const fit =
          mode === 'single'
            ? usable / unscaled.width
            : Math.min(
                (usable - (cols - 1) * SPREAD_GAP_PX) / (cols * unscaled.width),
                (container.clientHeight - 40 - (rows - 1) * SPREAD_GAP_PX) / (rows * unscaled.height)
              );
        setScale(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit)));
      });
    },
    [pdf, currentPage]
  );

  /**
   * Where the pointer was, in content coordinates, at the moment a wheel-zoom last changed
   * `scale` — read once by the layout effect below and cleared, so a zoom the toolbar's buttons
   * trigger (which never sets this) doesn't move the scroll position at all.
   */
  const wheelZoomAnchorRef = useRef<{ contentX: number; contentY: number; viewportX: number; viewportY: number; prevScale: number } | null>(null);

  /**
   * Ctrl+wheel and trackpad pinch both zoom the page under the cursor — Chromium reports a
   * trackpad pinch as a wheel event with `ctrlKey` set, indistinguishable from a physical
   * Ctrl+scroll, so one handler covers both. The browser's own page-zoom gesture is suppressed
   * with `preventDefault` so it doesn't fight this one; `{ passive: false }` is required for that
   * to have any effect.
   *
   * The exponential response (`Math.exp` rather than a fixed step) keeps the feel proportionate
   * whether `deltaY` arrives as the small fractional values a trackpad sends many times a second
   * or the larger, coarser notches a physical mouse wheel sends — unlike the toolbar's zoom
   * buttons, which deliberately snap to fixed steps instead.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const viewportX = e.clientX - rect.left;
      const viewportY = e.clientY - rect.top;

      setScale((prev) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * Math.exp(-e.deltaY * 0.01)));
        if (next === prev) return prev;
        wheelZoomAnchorRef.current = {
          contentX: el.scrollLeft + viewportX,
          contentY: el.scrollTop + viewportY,
          viewportX,
          viewportY,
          prevScale: prev
        };
        return next;
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /**
   * Restores the point under the cursor to the same screen position after a wheel-zoom resizes
   * the pages — must run after layout so it measures the container at the new scale, not the one
   * mid-transition.
   */
  useLayoutEffect(() => {
    const anchor = wheelZoomAnchorRef.current;
    const el = scrollRef.current;
    wheelZoomAnchorRef.current = null;
    if (!anchor || !el) return;
    const ratio = scale / anchor.prevScale;
    el.scrollLeft = anchor.contentX * ratio - anchor.viewportX;
    el.scrollTop = anchor.contentY * ratio - anchor.viewportY;
  }, [scale]);

  /** The scroll animation in flight, so a new jump replaces it rather than fighting it. */
  const scrollAnimation = useRef<number | null>(null);

  return { bookOn, bookRef, bookTurnRef, fitWidth, goToPage, handleViewModeChange, pageRef, reduceMotion, scrollAnimation };
}
