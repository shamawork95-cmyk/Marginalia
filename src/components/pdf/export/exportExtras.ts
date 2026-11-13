/**
 * The export's appended "Notes continued" pages, and handing the finished file to the reader (moved
 * verbatim from exportAnnotatedPdf).
 */

import { PDFDocument } from 'pdf-lib';
import { fontStack } from '../annotationModel';
import { wrapLines } from '../noteFit';
import { rasterizeText } from './exportText';

/**
 * "Notes continued": the full words of every note and text box that did not fit its box, in page
 * order, each headed by where it sits. Drawn as images of text (as the notes are) so any script
 * prints, and paginated onto as many pages as it takes, sized like the document's first page.
 */
export async function appendNotesPages(
  pdfDoc: PDFDocument,
  entries: { page: number; label: string; text: string }[],
  size: { width: number; height: number } = { width: 595, height: 842 }
): Promise<void> {
  const margin = 54;
  const width = size.width - margin * 2;
  let page = pdfDoc.addPage([size.width, size.height]);
  let y = size.height - margin;
  const place = async (lines: string[], fontCss: string, lineHeight: number, color: string) => {
    for (const line of lines) {
      if (y - lineHeight < margin) {
        page = pdfDoc.addPage([size.width, size.height]);
        y = size.height - margin;
      }
      const img = await rasterizeText([line || ' '], { fontCss, color, align: 'left', widthPt: width, lineHeightPt: lineHeight });
      if (img) page.drawImage(await pdfDoc.embedPng(img.bytes), { x: margin, y: y - img.heightPt, width: img.widthPt, height: img.heightPt });
      y -= lineHeight;
    }
  };
  const ctx = document.createElement('canvas').getContext('2d');
  const wrap = (text: string, fontCss: string): string[] => {
    if (!ctx) return text.split('\n');
    ctx.font = fontCss;
    return wrapLines(text, 1, width, (s) => ctx.measureText(s).width);
  };
  const title = `20px ${fontStack('serif')}`;
  const head = `bold 11px ${fontStack('sans')}`;
  const body = `12px ${fontStack('serif')}`;
  await place(['Notes continued'], title, 30, '#1c1917');
  y -= 6;
  for (const e of [...entries].sort((a, b) => a.page - b.page)) {
    await place([`${e.label} · page ${e.page}`], head, 18, '#6b6459');
    await place(wrap(e.text, body), body, 16, '#1c1917');
    y -= 12;
  }
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
