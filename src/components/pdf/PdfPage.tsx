/**
 * One rendered page: the canvas pdf.js paints, the transparent text layer that makes it
 * selectable, and the overlay annotations are drawn into.
 *
 * All three are stacked in one relatively positioned box of exactly the page's size, which is
 * what lets annotations be positioned in percentages — the box IS the coordinate space the
 * fractions in `annotationModel` are relative to.
 *
 * Pages render lazily. A long document rendered eagerly would allocate a full-resolution canvas
 * per page and exhaust memory well before the reader scrolled near the end, so a page paints only
 * when it is close to the viewport and releases its canvas once it is far away again.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import { Trash2 } from '../icons';
import {
  Annotation,
  BracketSide,
  NoteStyle,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont,
  isTextAnchored
} from './annotationModel';
import { AnnotationLayer, TextMarkLayer } from './AnnotationLayer';
import { TURN_MS } from '../pageTurn';
import { pageImageKey, pageImages } from './pageImageCache';

/** One key per loaded PDF (a page edit loads a new one), for the page image cache. */
const docKeys = new WeakMap<object, string>();
let nextDocKey = 0;
const docKeyOf = (pdf: object) => docKeys.get(pdf) ?? (docKeys.set(pdf, `pdf${++nextDocKey}`), docKeys.get(pdf)!);
import './pdfTextLayer.css';

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  annotations: Annotation[];
  tool: PdfTool;
  activeColor: string;
  activeThemeIds: string[];
  /** The reader's themes, for the dots on a mark under several. */
  themes?: { id: string; name: string; color: string }[];
  /** Live colour for `isTerminology` marks — see `TextMarkLayer`. */
  terminologyColor: string;
  toolWeight?: number;
  toolStrokeStyle?: StrokeStyle;
  toolNoteStyle?: NoteStyle;
  toolBracketSide?: BracketSide;
  toolTextSize?: number;
  toolTextAlign?: TextAlign;
  toolTextFont?: TextFont;
  toolTextBold?: boolean;
  toolTextItalic?: boolean;
  isDark: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (annotation: Annotation) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onHover: (id: string | null) => void;
  onVisible: (pageNumber: number) => void;
  /** Removes this page from the document entirely. Absent when the document has only one page
   *  left — a PDF can't go to zero pages, so there is nothing this button could do there. */
  onDeletePage?: () => void;
  /**
   * Book view's neighbouring pages (2.8.0): drawn now, kept out of sight and out of reach, so a
   * page turn lands on finished pages. Drawing them only once the turn began held the turn up
   * on the main thread, and the leaf carrying the old pages' marks stayed on screen 1–2 s.
   */
  offstage?: boolean;
  /** Four or six pages in view: drawn at screen resolution, not the device's, for speed. */
  lowRes?: boolean;
}

export const PdfPage: React.FC<PdfPageProps> = ({
  pdf,
  pageNumber,
  scale,
  annotations,
  tool,
  activeColor,
  activeThemeIds,
  themes,
  terminologyColor,
  toolWeight,
  toolStrokeStyle,
  toolNoteStyle,
  toolBracketSide,
  toolTextSize,
  toolTextAlign,
  toolTextFont,
  toolTextBold,
  toolTextItalic,
  isDark,
  selectedId,
  hoveredId,
  onSelect,
  onCreate,
  onDelete,
  onEdit,
  onUpdate,
  onHover,
  onVisible,
  onDeletePage,
  offstage = false,
  lowRes = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textLayerInstanceRef = useRef<TextLayer | null>(null);

  const [isNear, setIsNear] = useState(pageNumber <= 2);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [isRendered, setIsRendered] = useState(false);
  /**
   * The canvas shows this page (painted by pdf.js, or from the page image cache). Marks are drawn
   * only from then on: before, new marks floated over a blank "Page N" placeholder.
   */
  const [painted, setPainted] = useState(false);
  /** A second tap to confirm, right where the first one was, rather than a separate dialog —
   *  removing a page is destructive (it takes any marks on it with it) but common enough while
   *  cleaning up an inserted page that a modal every time would be a tax on the common case. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Two observers: a wide margin decides whether the page renders at all, a tight one reports
  // which page the reader is actually looking at.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const near = new IntersectionObserver(([e]) => setIsNear(e.isIntersecting), {
      rootMargin: '1200px 0px'
    });
    /**
     * Which page the reader is looking at, defined as the one crossing a thin band across the
     * middle of the viewport.
     *
     * This used to ask for `threshold: 0.5` — half the page on screen. A page taller than the
     * window can never satisfy that, so above roughly 150% zoom the observer stopped firing
     * entirely and the toolbar's page number froze on whatever it last said, no matter how far
     * the reader scrolled. A band is zoom-independent: a postage-stamp page and a page three
     * screens tall both either cross the middle of the window or do not.
     */
    const visible = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) onVisible(pageNumber);
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    near.observe(el);
    visible.observe(el);
    return () => {
      near.disconnect();
      visible.disconnect();
    };
  }, [pageNumber, onVisible]);

  // Establish the page's box before it has painted. Without this an unrendered page would be
  // zero-height, the scroll container would have no real length, and lazy rendering would never
  // trigger for anything past the first screen.
  useEffect(() => {
    let cancelled = false;
    pdf.getPage(pageNumber).then((page: PDFPageProxy) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setSize({ width: viewport.width, height: viewport.height });
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, scale]);

  const renderPage = useCallback(async () => {
    const canvas = canvasRef.current;
    const textLayerDiv = textLayerRef.current;
    if (!canvas || !textLayerDiv) return;

    // A re-render at a new zoom can start while the previous one is still painting; the old task
    // must be cancelled or the two write to the same canvas and tear.
    renderTaskRef.current?.cancel();
    textLayerInstanceRef.current?.cancel();

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    // Paint at device resolution and scale back down with CSS, so text stays sharp on HiDPI
    // screens instead of being upscaled from a CSS-pixel-sized bitmap.
    const outputScale = lowRes ? 1 : window.devicePixelRatio || 1;
    const key = pageImageKey(docKeyOf(pdf), pageNumber, scale, outputScale);
    const cached = pageImages.get(key);
    if (!cached) setPainted(false);
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;

    if (cached) {
      // Seen before at this zoom: on screen at once, no pdf.js paint (seconds on a scanned page).
      context.drawImage(cached, 0, 0);
    } else {
      const task = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
      } as Parameters<PDFPageProxy['render']>[0]);
      renderTaskRef.current = task;

      try {
        await task.promise;
      } catch (err: any) {
        // Cancelling is the normal outcome of zooming or scrolling away mid-render, not a fault.
        if (err?.name !== 'RenderingCancelledException') console.warn('PDF page render failed:', err);
        return;
      }
      // Kept for next time (a turn back, a scroll back). Off the critical path.
      if (typeof createImageBitmap === 'function') {
        void createImageBitmap(canvas)
          .then((bitmap) => pageImages.set(key, bitmap))
          .catch(() => undefined);
      }
    }
    setPainted(true);

    // The text layer is what makes the document selectable, and selection is what the highlight,
    // underline and strikeout tools are built from — so a failure here is reported rather than
    // swallowed, which would leave a page that looks fine but cannot be marked.
    try {
      textLayerDiv.replaceChildren();
      const textLayer = new TextLayer({
        textContentSource: await page.getTextContent(),
        container: textLayerDiv,
        viewport
      });
      textLayerInstanceRef.current = textLayer;
      await textLayer.render();

      /*
        Append the `.endOfContent` element that stops the selection running away.

        This is the piece that was missing. pdf.js's CORE `TextLayer` does not create it — only
        the viewer's `TextLayerBuilder` does, after render — so the CSS rule for it had nothing to
        apply to and the fix was inert. Parked below the page it does nothing; while a drag is in
        progress the `selecting` class pulls it up to cover the layer, so the empty space between
        paragraphs belongs to a non-selectable element rather than resolving to whichever
        absolutely positioned span happens to be closest.
      */
      const endOfContent = document.createElement('div');
      endOfContent.className = 'endOfContent';
      textLayerDiv.append(endOfContent);
    } catch (err) {
      console.error(`Text layer failed on page ${pageNumber}:`, err);
      (window as unknown as { __marginaliaTextLayerError?: string }).__marginaliaTextLayerError =
        String((err as Error)?.message || err);
    }

    setIsRendered(true);
  }, [pdf, pageNumber, scale, lowRes]);

  // Offstage pages are always drawn (they sit out of view, where the observer never sees them).
  const shouldRender = isNear || offstage;
  useEffect(() => {
    if (!shouldRender || !size) return;
    // An offstage page waits out the page turn that brought it next door, so drawing it never
    // competes with the turn for the main thread.
    const wait = offstage && !isNear ? TURN_MS + 150 : 0;
    const timer = window.setTimeout(() => void renderPage(), wait);
    return () => {
      window.clearTimeout(timer);
      renderTaskRef.current?.cancel();
      textLayerInstanceRef.current?.cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRender, size, renderPage]);

  // Clears the `selecting` state everywhere once the drag ends, wherever it ended.
  useEffect(() => {
    const clear = () =>
      document
        .querySelectorAll('.marginalia-text-layer.selecting')
        .forEach((el) => el.classList.remove('selecting'));
    document.addEventListener('pointerup', clear);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('pointerup', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // Release the bitmap once well out of view. Each canvas is several megabytes at typical zoom,
  // so holding every visited page would grow without bound over a long document.
  useEffect(() => {
    if (shouldRender) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    textLayerRef.current?.replaceChildren();
    setIsRendered(false);
    setPainted(false);
  }, [isNear]);

  // Text stays selectable unless a tool that needs the pointer for drawing is armed — including
  // under Select, which is the resting state.
  // 'mask' belongs here with the other drawing tools: it draws a stroke, so the text under it
  // should not be selectable while it is armed. It only escaped notice because the annotation
  // layer's drag capture happens to swallow the pointer first.
  const selectable = !['ink', 'mask', 'maskPen', 'note', 'rect', 'ellipse', 'arrow', 'line', 'bracket', 'text'].includes(tool);

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      data-offstage={offstage || undefined}
      // The book's page turn waits for this before it starts (usePdfNavigation).
      data-painted={painted || undefined}
      aria-hidden={offstage || undefined}
      inert={offstage || undefined}
      // False until pdf.js has reported this page's real size. Until then the element still has
      // a height — a 60vh placeholder — so anything measuring it lands on a guess.
      data-page-sized={String(Boolean(size))}
      className={`group relative mx-auto shadow-lg rounded-sm ${isDark ? 'bg-stone-200' : 'bg-white'}`}
      style={{
        width: size ? `${size.width}px` : '100%',
        height: size ? `${size.height}px` : '60vh',
        ...(offstage ? { position: 'absolute', left: '-200vw', top: 0, visibility: 'hidden', pointerEvents: 'none' } : {}),
        // The text layer's font sizing is expressed against this variable.
        ['--total-scale-factor' as never]: String(scale)
      }}
    >
      <canvas ref={canvasRef} className="block absolute inset-0" />

      {/* Delete this page — resting quietly out of the way until the reader is actually looking
          at this corner, the same "revealed on hover" rule the library shelf's own card actions
          follow, so a page at rest reads as a page rather than a row of controls. */}
      {onDeletePage && (
        <div className="absolute bottom-2 right-2 z-20">
          {confirmingDelete ? (
            <div
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg shadow-lg border text-[11px] ${
                isDark ? 'bg-night-4 border-stone-700 text-stone-200' : 'bg-white border-stone-200 text-stone-700'
              }`}
            >
              <span className="font-medium">Delete page {pageNumber}?</span>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="px-1.5 py-0.5 rounded text-muted hover:text-stone-800 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  onDeletePage();
                }}
                className="px-1.5 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer"
              >
                Delete
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              title={`Delete page ${pageNumber}`}
              aria-label={`Delete page ${pageNumber}`}
              className="p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Below the text layer, deliberately — see `TextMarkLayer`. Hidden (not unmounted) until
          the page has painted, so marks never float over a blank page. */}
      <div style={{ display: 'contents', visibility: painted ? undefined : 'hidden' }}>
        <TextMarkLayer
          annotations={annotations}
          pageWidth={size?.width ?? 0}
          selectedId={selectedId}
          hoveredId={hoveredId}
          terminologyColor={terminologyColor}
          themes={themes}
        />
      </div>

      {/* Placeholder while a page is off-screen or mid-render, so scrolling a long document shows
          page-shaped space rather than a collapsing gap. */}
      {!painted && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-stone-600 select-none">
          Page {pageNumber}
        </div>
      )}

      {/*
        `selecting` is on for the duration of a drag, which is what raises `.endOfContent` over
        the layer. It is cleared from a document-level listener rather than this element's own
        pointerup, because a drag very often ends with the pointer outside the page it started on.
      */}
      <div
        ref={textLayerRef}
        className="marginalia-text-layer"
        data-selectable={String(selectable)}
        onMouseDown={(e) => e.currentTarget.classList.add('selecting')}
      />

      <div style={{ display: 'contents', visibility: painted ? undefined : 'hidden' }}>
      <AnnotationLayer
        pageNumber={pageNumber}
        pageRef={containerRef}
        pageWidth={size?.width ?? 0}
        pageHeight={size?.height ?? 0}
        annotations={annotations}
        tool={tool}
        activeColor={activeColor}
        activeThemeIds={activeThemeIds}
        toolWeight={toolWeight}
        toolStrokeStyle={toolStrokeStyle}
        toolNoteStyle={toolNoteStyle}
        toolBracketSide={toolBracketSide}
        toolTextSize={toolTextSize}
        toolTextAlign={toolTextAlign}
        toolTextFont={toolTextFont}
        toolTextBold={toolTextBold}
        toolTextItalic={toolTextItalic}
        selectedId={selectedId}
        hoveredId={hoveredId}
        onSelect={onSelect}
        onCreate={onCreate}
        onDelete={onDelete}
        onEdit={onEdit}
        onUpdate={onUpdate}
        onHover={onHover}
      />
      </div>
    </div>
  );
};
