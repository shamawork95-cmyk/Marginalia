/**
 * Exports a copy of the PDF with the reader's marks written in as NATIVE PDF annotations.
 *
 * Native matters: the output carries real `/Highlight`, `/Underline`, `/StrikeOut`, `/Ink`,
 * `/Square`, `/Circle`, `/Line`, `/FreeText` and `/Text` objects, so Preview, Acrobat and any
 * other reader show them as annotations that can be selected, commented on and removed. The
 * alternative — painting marks onto the page — bakes them into the image and cannot be undone.
 *
 * The coordinate conversion is the crux. Marks are stored as page fractions with the origin at
 * the TOP-left (how the browser lays out); PDF space is points with the origin at the BOTTOM-left
 * and its own page box. Every value therefore goes through `toPdf`, which flips y and scales by
 * the real MediaBox rather than assuming a page size.
 */

import { PDFDocument, PDFName, PDFArray, PDFString, PDFHexString, StandardFonts, rgb } from 'pdf-lib';
import { Annotation, FractionRect } from './annotationModel';

/** '#rrggbb' to the 0–1 components PDF colour arrays use. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full || '000000', 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export async function exportAnnotatedPdf(
  sourceUrl: string,
  annotations: Annotation[],
  fileName: string
): Promise<Blob> {
  const bytes = await (await fetch(sourceUrl)).arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  // Sticky notes are DRAWN into the page as well as registered as annotations, so their text is
  // visible in every reader rather than hidden behind an icon that has to be clicked. Drawing
  // needs a font; Helvetica is one of the 14 standard faces every PDF reader has built in, so it
  // embeds nothing and cannot fail to render. The app's handwriting face is a web font that
  // pdf-lib cannot embed without a TTF and a fontkit dependency, so exported notes are set in
  // Helvetica rather than Caveat — the placement, colour and wording are identical.
  const noteFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  /** Greedy word wrap to a pixel width, so a note's text stays inside its box. */
  const wrapText = (text: string, size: number, maxWidth: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.split(/\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (noteFont.widthOfTextAtSize(candidate, size) > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
    }
    return lines;
  };

  const byPage = new Map<number, Annotation[]>();
  for (const a of annotations) {
    const list = byPage.get(a.page);
    if (list) list.push(a);
    else byPage.set(a.page, [a]);
  }

  byPage.forEach((pageAnnotations, pageNumber) => {
    const page = pages[pageNumber - 1];
    if (!page) return;

    const { width: pw, height: ph } = page.getSize();
    /** Page fraction (top-left origin) to PDF points (bottom-left origin). */
    const toPdf = (x: number, y: number): [number, number] => [x * pw, ph - y * ph];
    const rectToPdf = (r: FractionRect): [number, number, number, number] => {
      const [x1, y1] = toPdf(r.x, r.y + r.h);
      const [x2, y2] = toPdf(r.x + r.w, r.y);
      return [x1, y1, x2, y2];
    };

    const context = pdfDoc.context;
    const annots: any[] = [];

    const common = (a: Annotation, rect: [number, number, number, number], extra: Record<string, any>) => {
      const { r, g, b } = hexToRgb(a.color);
      const dict: Record<string, any> = {
        Type: PDFName.of('Annot'),
        Rect: context.obj(rect),
        C: context.obj([r, g, b]),
        // `T` (title) carries the author; `Contents` the reader's own words. Both are what other
        // readers show in their annotation sidebars.
        T: PDFString.of(a.author || 'Reader'),
        Contents: PDFHexString.fromText(a.text || a.quote || ''),
        F: 4, // Print flag — without it the mark is on screen but absent from a printout.
        CreationDate: PDFString.fromDate(new Date(a.createdAt)),
        ...extra
      };
      annots.push(context.register(context.obj(dict)));
    };

    for (const a of pageAnnotations) {
      const { r, g, b } = hexToRgb(a.color);

      if (a.rects?.length && (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout')) {
        // QuadPoints order is upper-left, upper-right, lower-left, lower-right — NOT a rectangle
        // and not a winding order. Getting this wrong is the classic way highlights land in the
        // wrong place or collapse to nothing.
        const quads: number[] = [];
        for (const rect of a.rects) {
          const [x1, y1, x2, y2] = rectToPdf(rect);
          quads.push(x1, y2, x2, y2, x1, y1, x2, y1);
        }
        const bounds = rectToPdf({
          x: Math.min(...a.rects.map((q) => q.x)),
          y: Math.min(...a.rects.map((q) => q.y)),
          w: Math.max(...a.rects.map((q) => q.x + q.w)) - Math.min(...a.rects.map((q) => q.x)),
          h: Math.max(...a.rects.map((q) => q.y + q.h)) - Math.min(...a.rects.map((q) => q.y))
        });
        common(a, bounds, {
          Subtype: PDFName.of(
            a.kind === 'highlight' ? 'Highlight' : a.kind === 'underline' ? 'Underline' : 'StrikeOut'
          ),
          QuadPoints: context.obj(quads)
        });
        continue;
      }

      if (a.kind === 'ink' && a.points?.length) {
        const flat: number[] = [];
        for (const p of a.points) {
          const [x, y] = toPdf(p.x, p.y);
          flat.push(x, y);
        }
        const xs = a.points.map((p) => p.x);
        const ys = a.points.map((p) => p.y);
        common(
          a,
          rectToPdf({
            x: Math.min(...xs),
            y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs),
            h: Math.max(...ys) - Math.min(...ys)
          }),
          {
            Subtype: PDFName.of('Ink'),
            // InkList is a list OF strokes, so a single stroke still nests one level down.
            InkList: context.obj([context.obj(flat)]),
            BS: context.obj({ W: Math.max(1, (a.weight ?? 0.003) * pw) })
          }
        );
        continue;
      }

      if ((a.kind === 'rect' || a.kind === 'ellipse') && a.box) {
        common(a, rectToPdf(a.box), {
          Subtype: PDFName.of(a.kind === 'rect' ? 'Square' : 'Circle'),
          IC: context.obj([]), // No interior fill: these are outlines.
          BS: context.obj({ W: Math.max(1, (a.weight ?? 0.003) * pw) })
        });
        continue;
      }

      if ((a.kind === 'arrow' || a.kind === 'line') && a.from && a.to) {
        const [x1, y1] = toPdf(a.from.x, a.from.y);
        const [x2, y2] = toPdf(a.to.x, a.to.y);
        common(
          a,
          [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
          {
            Subtype: PDFName.of('Line'),
            L: context.obj([x1, y1, x2, y2]),
            // Line endings: an open arrowhead at the far end, nothing at the near one.
            LE: context.obj([PDFName.of('None'), PDFName.of(a.kind === 'arrow' ? 'OpenArrow' : 'None')]),
            BS: context.obj({ W: Math.max(1, (a.weight ?? 0.003) * pw) })
          }
        );
        continue;
      }

      if (a.kind === 'text' && a.box) {
        common(a, rectToPdf(a.box), {
          Subtype: PDFName.of('FreeText'),
          // DA is the appearance string: colour then font and size, in PDF operator syntax.
          DA: PDFString.of(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg /Helv 11 Tf`),
          Q: 0
        });
        continue;
      }

      if (a.kind === 'note' && a.box) {
        const [x1, y1, x2, y2] = rectToPdf(a.box);
        const boxWidth = x2 - x1;
        const boxHeight = y2 - y1;

        // A solid panel in the note's own colour, matching how it looks in the app so an
        // exported page is recognisably the same document.
        page.drawRectangle({
          x: x1,
          y: y1,
          width: boxWidth,
          height: boxHeight,
          color: rgb(r, g, b),
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
          borderOpacity: 0.12
        });

        const text = (a.text || '').trim();
        if (text) {
          // Sized to the note rather than fixed, so a small note gets small text instead of
          // overflowing, then clipped to whatever lines actually fit.
          const size = Math.max(6, Math.min(12, boxHeight / 5));
          const lineHeight = size * 1.25;
          const lines = wrapText(text, size, boxWidth - 12);
          const maxLines = Math.max(1, Math.floor((boxHeight - 6) / lineHeight));
          // Ink chosen against the fill, the same rule the app uses, so a dark note stays
          // readable instead of printing black on near-black.
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          const ink = luminance < 0.6 ? rgb(1, 0.99, 0.96) : rgb(0.11, 0.09, 0.09);
          lines.slice(0, maxLines).forEach((line, index) => {
            page.drawText(line, {
              x: x1 + 8,
              y: y2 - 6 - size - index * lineHeight,
              size,
              font: noteFont,
              color: ink
            });
          });
        }

        // Registered as a real annotation too, so the note is also selectable and its full text
        // readable in a PDF reader's annotation list even when the drawn box had to clip it.
        common(a, [x1, y1, x2, y2], {
          Subtype: PDFName.of('FreeText'),
          DA: PDFString.of(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg /Helv 11 Tf`),
          Q: 0
        });
      }
    }

    if (annots.length === 0) return;

    // Append to any annotations the file already had rather than replacing them.
    const existing = page.node.get(PDFName.of('Annots'));
    if (existing instanceof PDFArray) {
      for (const ref of annots) existing.push(ref);
    } else {
      page.node.set(PDFName.of('Annots'), context.obj(annots));
    }
  });

  const out = await pdfDoc.save();
  void fileName;
  return new Blob([out as unknown as BlobPart], { type: 'application/pdf' });
}

/** Hands the exported file to the user. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a delay: revoking immediately can cancel the download in some browsers before it
  // has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
