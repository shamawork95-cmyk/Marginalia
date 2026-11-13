/**
 * Black it out, on export.
 *
 * A black box drawn over a PDF hides words from the eye only: the words are still in the page's
 * content, and can be copied, searched or read out from the exported file. "Remove the hidden
 * text too" makes it a true redaction: each page with a black-out is replaced by a picture of
 * itself with the black-outs painted in, so nothing under them survives. The cost, said plainly
 * in the export dialog, is that the words elsewhere on those pages stop being selectable text.
 * Pages without a black-out are untouched.
 *
 * The pure parts (which marks, which pages, what a mark's note may still say) are tested; the
 * painting needs a canvas.
 */

import { annotationBounds, isBlackout, type Annotation, type FractionRect } from '../annotationModel';

/** Black-out marks by page (1-based). */
export function blackoutsByPage(annotations: readonly Annotation[]): Map<number, Annotation[]> {
  const out = new Map<number, Annotation[]>();
  for (const a of annotations) {
    if (!isBlackout(a)) continue;
    const list = out.get(a.page);
    if (list) list.push(a);
    else out.set(a.page, [a]);
  }
  return out;
}

const overlaps = (a: FractionRect, b: FractionRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Whether another mark on the page touches a black-out. Its quote (the marked words) is then left
 * out of a redacted export, or the words could survive in the mark's note in the PDF.
 */
export function touchesBlackout(a: Annotation, blackouts: readonly Annotation[]): boolean {
  if (isBlackout(a)) return false;
  const boxes = a.rects?.length ? a.rects : [annotationBounds(a)].filter((r): r is FractionRect => Boolean(r));
  return blackouts.some((b) => {
    const bb = annotationBounds(b);
    return Boolean(bb) && boxes.some((r) => overlaps(r, bb!));
  });
}

/** The words a mark's PDF note carries: its own text, and its quote unless that may be hidden. */
export function exportedNoteText(a: Annotation, blackouts: readonly Annotation[], redact: boolean): string {
  if (redact && touchesBlackout(a, blackouts)) return a.text || '';
  return a.text || a.quote || '';
}

/** Paints black-outs onto a canvas showing the page at `width`×`height` px (fractions are of the page as seen). */
export function paintBlackouts(ctx: CanvasRenderingContext2D, marks: readonly Annotation[], width: number, height: number): void {
  for (const m of marks) {
    ctx.fillStyle = m.color || '#000000';
    ctx.strokeStyle = m.color || '#000000';
    if (m.kind === 'ink' && m.points && m.points.length > 1) {
      ctx.lineWidth = Math.max(2, (m.weight ?? 0.02) * width);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      m.points.forEach((p, i) => (i ? ctx.lineTo(p.x * width, p.y * height) : ctx.moveTo(p.x * width, p.y * height)));
      ctx.stroke();
      continue;
    }
    const b = annotationBounds(m);
    if (b) ctx.fillRect(Math.floor(b.x * width), Math.floor(b.y * height), Math.ceil(b.w * width) + 1, Math.ceil(b.h * height) + 1);
  }
}

/** Long side of the page picture, in px: sharp enough to read and print (~200 dpi on A4). */
export const REDACTED_PAGE_PX = 2400;

/** Scale for pdf.js so the page's long side is REDACTED_PAGE_PX. */
export function redactionScale(page: { width: number; height: number }): number {
  return REDACTED_PAGE_PX / Math.max(page.width, page.height, 1);
}

/**
 * A copy of `source` in which every page with a black-out is a picture of itself with the
 * black-outs painted in, and every other page is copied as it was.
 *
 * A NEW document, not the source with pages swapped: pdf-lib writes every object it holds, so a
 * page removed from the source would still carry its words into the saved file. Copying only the
 * pages kept leaves the replaced pages' content behind. (Outlines and document-level extras of the
 * source are not carried over in a redacted export.)
 */
export async function redactedCopy(
  source: import('pdf-lib').PDFDocument,
  sourceBytes: ArrayBuffer,
  blackouts: Map<number, Annotation[]>
): Promise<import('pdf-lib').PDFDocument> {
  const { PDFDocument } = await import('pdf-lib');
  const { getDocument } = await import('pdfjs-dist');
  const out = await PDFDocument.create();
  const task = getDocument({ data: new Uint8Array(sourceBytes.slice(0)) });
  const rendered = await task.promise;
  try {
    const count = source.getPageCount();
    for (let i = 0; i < count; i++) {
      const marks = blackouts.get(i + 1);
      if (!marks?.length) {
        const [copy] = await out.copyPages(source, [i]);
        out.addPage(copy);
        continue;
      }
      const page = await rendered.getPage(i + 1);
      const seen = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: redactionScale(seen) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No canvas to redact on');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
      paintBlackouts(ctx, marks, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error('Could not draw the redacted page');
      const image = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const fresh = out.addPage([seen.width, seen.height]);
      fresh.drawImage(image, { x: 0, y: 0, width: seen.width, height: seen.height });
    }
  } finally {
    await task.destroy();
  }
  return out;
}
