/**
 * Navigation and zoom: the book view and its page turns, keys and swipe, going to a page, restoring
 * the reading position, fit width, pages in view and wheel zoom (moved verbatim from PdfWorkspace).
 */

import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { type PDFDocumentProxy } from 'pdfjs-dist';
import { useReducedMotion } from 'motion/react';
import { playTurn, snapshotPage, turnDirection, waitFor, TURN_WAIT_MAX_MS, type PageBox } from '../../pageTurn';
import { isTypingTarget } from '../workspaceKeys';
import { isTextAnchored, type PdfTool } from '../annotationModel';
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
import { fitScale } from './viewFit';

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
  /** The armed tool: a drawing tool (pen, shapes, notes…) turns swiping off. */
  tool?: PdfTool;
}

export function usePdfNavigation(deps: UsePdfNavigationDeps) {
  const { tool, currentPage, docId, fittedRef, jumpToPage, pageCount, pdf, restoredPageRef, resumeReading, scale, scrollRef, setCurrentPage, setLayoutSettled, setScale, setViewMode, viewMode, zoomTouchedRef } = deps;

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
  /** A turn waiting for its pages to paint: where it is going. Keys and swipes step on from here. */
  const pendingRef = useRef<{ page: number; cancel: () => void } | null>(null);
  useEffect(() => () => pendingRef.current?.cancel(), []);
  const turnToPage = (page: number, animate: boolean) => {
    const book = bookRef.current;
    const pageEl = (n: number) => book?.querySelector<HTMLElement>(`[data-page-number="${n}"]`) ?? null;
    pendingRef.current?.cancel();
    pendingRef.current = null;
    const to = Math.floor((page - 1) / 2);
    const targets = [2 * to + 1, 2 * to + 2].filter((n) => n <= pageCount).map(pageEl);
    const ready = () => targets.every((el) => el?.dataset.painted);
    // Turn only onto finished pages: while they paint, the book shows it is turning (cursor and
    // a status for screen readers), then turns. Never longer than TURN_WAIT_MAX_MS.
    if (animate && book && targets.every(Boolean) && !ready()) {
      book.dataset.turning = 'true';
      book.setAttribute('aria-busy', 'true');
      const stop = waitFor(book, ready, TURN_WAIT_MAX_MS, () => {
        pendingRef.current = null;
        delete book.dataset.turning;
          book.removeAttribute('aria-busy');
        startTurn(page, true);
      });
      pendingRef.current = {
        page,
        cancel: () => {
          stop();
          delete book.dataset.turning;
          book.removeAttribute('aria-busy');
        }
      };
      return;
    }
    startTurn(page, animate);
  };
  const startTurn = (page: number, animate: boolean) => {
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
      const pair = Math.floor(((pendingRef.current?.page ?? pageRef.current) - 1) / 2) + step;
      const page = Math.min(pageCount, Math.max(1, pair * 2 + 1));
      if (page !== (pendingRef.current?.page ?? pageRef.current)) bookTurnRef.current?.(page, true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bookOn, pageCount]);

  // A sideways swipe (finger, pen, trackpad) turns the book too.
  const swipeTurn = useCallback(
    (step: 1 | -1) => {
      const pair = Math.floor(((pendingRef.current?.page ?? pageRef.current) - 1) / 2) + step;
      const page = Math.min(pageCount, Math.max(1, pair * 2 + 1));
      if (page !== (pendingRef.current?.page ?? pageRef.current)) bookTurnRef.current?.(page, true);
    },
    [pageCount]
  );
  // Not while a drawing tool is armed: the finger is drawing, not turning.
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const swipeBlocked = useCallback(() => {
    const t = toolRef.current;
    return Boolean(t && t !== 'select' && !isTextAnchored(t));
  }, []);
  useSwipeTurn(scrollRef, swipeTurn, bookOn, swipeBlocked);

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
      clampToWindow(stored.viewMode, stored.scale);
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
      clampToWindow(remoteReadingState.viewMode, remoteReadingState.scale);
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

  /**
   * A book or grid saved on a bigger screen opened too large on a small one (at 1366×768 the left
   * page sat under the sidebar): on open, its zoom is never more than fits the whole set.
   */
  const clampToWindow = (mode: PdfViewMode, stored: number) => {
    const container = scrollRef.current;
    if (mode === 'single' || !pdf || !container) return;
    void pdf.getPage(1).then((page) => {
      const fit = fitScale(mode, page.getViewport({ scale: 1 }), { width: container.clientWidth, height: container.clientHeight });
      if (!zoomTouchedRef.current && fit < stored) setScale(Math.max(MIN_ZOOM, fit));
    });
  };

  /** Fit page: the whole page (or the book's pair, or the grid) in the window, width and height. */
  const fitPage = useCallback(async () => {
    if (!pdf || !scrollRef.current) return;
    zoomTouchedRef.current = true;
    const page = await pdf.getPage(currentPage);
    const container = scrollRef.current;
    const fit = fitScale(viewMode, page.getViewport({ scale: 1 }), { width: container.clientWidth, height: container.clientHeight }, true);
    setScale(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit)));
  }, [pdf, currentPage, viewMode]);

  const fitWidth = useCallback(async () => {
    if (!pdf || !scrollRef.current) return;
    const page = await pdf.getPage(currentPage);
    const unscaled = page.getViewport({ scale: 1 });
    setScale(Math.max(0.25, Math.min(5, (scrollRef.current.clientWidth - 48) / unscaled.width)));
  }, [pdf, currentPage]);



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
        // the window, and the reader had to zoom back by hand. The book and the grids fit their
        // whole set, across and down (viewFit.ts); one page fits the width.
        const fit = fitScale(mode, unscaled, { width: container.clientWidth, height: container.clientHeight });
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

  /** From a grid: that page at reading size, one page in view (fit to width). */
  const openPage = useCallback(
    (page: number) => {
      handleViewModeChange('single');
      setCurrentPage(page);
      // Again as the pages take their new sizes (each learns its size from pdf.js a moment later),
      // so the page lands at the top of the window rather than where it was mid-relayout.
      const jump = () => scrollRef.current?.querySelector(`[data-page-number="${page}"]`)?.scrollIntoView({ block: 'start' });
      requestAnimationFrame(() => requestAnimationFrame(jump));
      window.setTimeout(jump, 250);
      window.setTimeout(jump, 600);
    },
    [handleViewModeChange]
  );

  return { bookOn, bookRef, bookTurnRef, fitPage, openPage, fitWidth, goToPage, handleViewModeChange, pageRef, reduceMotion, scrollAnimation };
}
