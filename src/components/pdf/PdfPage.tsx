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
import { Annotation, PdfTool, isTextAnchored } from './annotationModel';
import { AnnotationLayer } from './AnnotationLayer';
import './pdfTextLayer.css';

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  annotations: Annotation[];
  tool: PdfTool;
  activeColor: string;
  activeThemeId: string | null;
  toolWeight?: number;
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
}

export const PdfPage: React.FC<PdfPageProps> = ({
  pdf,
  pageNumber,
  scale,
  annotations,
  tool,
  activeColor,
  activeThemeId,
  toolWeight,
  isDark,
  selectedId,
  hoveredId,
  onSelect,
  onCreate,
  onDelete,
  onEdit,
  onUpdate,
  onHover,
  onVisible
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textLayerInstanceRef = useRef<TextLayer | null>(null);

  const [isNear, setIsNear] = useState(pageNumber <= 2);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [isRendered, setIsRendered] = useState(false);

  // Two observers: a wide margin decides whether the page renders at all, a tight one reports
  // which page the reader is actually looking at.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const near = new IntersectionObserver(([e]) => setIsNear(e.isIntersecting), {
      rootMargin: '1200px 0px'
    });
    const visible = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) onVisible(pageNumber);
      },
      { threshold: 0.5 }
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
    const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;

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
  }, [pdf, pageNumber, scale]);

  useEffect(() => {
    if (!isNear || !size) return;
    void renderPage();
    return () => {
      renderTaskRef.current?.cancel();
      textLayerInstanceRef.current?.cancel();
    };
  }, [isNear, size, renderPage]);

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
    if (isNear) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    textLayerRef.current?.replaceChildren();
    setIsRendered(false);
  }, [isNear]);

  // Text stays selectable unless a tool that needs the pointer for drawing is armed — including
  // under Select, which is the resting state.
  const selectable = !['ink', 'note', 'rect', 'ellipse', 'arrow', 'line', 'text'].includes(tool);

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      className={`relative mx-auto shadow-lg rounded-sm ${isDark ? 'bg-stone-200' : 'bg-white'}`}
      style={{
        width: size ? `${size.width}px` : '100%',
        height: size ? `${size.height}px` : '60vh',
        // The text layer's font sizing is expressed against this variable.
        ['--total-scale-factor' as never]: String(scale)
      }}
    >
      <canvas ref={canvasRef} className="block absolute inset-0" />

      {/* Placeholder while a page is off-screen or mid-render, so scrolling a long document shows
          page-shaped space rather than a collapsing gap. */}
      {!isRendered && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-stone-400 select-none">
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

      <AnnotationLayer
        pageNumber={pageNumber}
        pageRef={containerRef}
        pageWidth={size?.width ?? 0}
        annotations={annotations}
        tool={tool}
        activeColor={activeColor}
        activeThemeId={activeThemeId}
        toolWeight={toolWeight}
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
  );
};
