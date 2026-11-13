/**
 * Helpers for the annotated-PDF export: fonts, colours, text drawn as images (so any script prints) and
 * fitted to its box, and dash patterns (moved verbatim from exportAnnotatedPdf).
 */

import { Annotation, StrokeStyle, TextAlign } from '../annotationModel';
import { fitText, type FitOptions, type FittedText, type Measure } from '../noteFit';

/**
 * The base-14 font name for a `FreeText` annotation's `/DA` string — metadata only.
 *
 * The actual glyphs a reader sees are the ones drawn onto the page with the real embedded face
 * (see `textFontFor`/`embeddedFont`); `/DA` just tells a viewer's own annotation sidebar what to
 * fall back to, and sidebars cannot reference an arbitrary embedded font by name — only one of
 * the fourteen every PDF reader has built in. The handwriting face has no counterpart there, so
 * it names the serif it most resembles for that narrow purpose alone.
 */
export function freeTextFont(a: Annotation): string {
  const family = a.font === 'mono' ? 'Cour' : a.font === 'sans' ? 'Helv' : 'Times';
  const bold = a.bold ? 'B' : '';
  const italic = a.italic ? (family === 'Times' ? 'I' : 'O') : '';
  if (!bold && !italic) return family === 'Times' ? 'TiRo' : family;
  return `${family}${bold}${italic}`;
}

/** '#rrggbb' to the 0–1 components PDF colour arrays use. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full || '000000', 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** True for colours light enough that dark ink reads better on them than light — the same rule
 *  `AnnotationLayer` uses to pick a solid note's text colour. */
export function isDarkFill(r: number, g: number, b: number): boolean {
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.6;
}

/**
 * Rasterizes a note's or text box's own words through the BROWSER's text engine, rather than
 * through `@pdf-lib/fontkit`'s.
 *
 * `@pdf-lib/fontkit` was found — against this exact bundled font file, verified glyph-by-glyph —
 * to mis-shape Caveat's cursive contextual-alternate glyphs: wrong, wildly uneven spacing and a
 * scrambled text-extraction mapping, with no feature flag able to turn the substitution off.
 * Chromium (what both the app's own on-screen note and, packaged, the desktop build itself render
 * with) shapes the very same font file correctly. Canvas text goes through that same engine, so
 * what gets embedded is guaranteed to match what the reader actually made — at the cost of the
 * text becoming a baked image rather than a selectable PDF text object. For a handwritten margin
 * note that is the right trade: the annotation object registered alongside it (see `common`)
 * still carries the real text for a reader's sidebar and search, and a font that shapes wrongly is
 * a worse loss than one that cannot be copy-pasted from the page itself.
 *
 * Draws in a coordinate space of 1 canvas unit = 1 PDF point, upscaled by `scale` for a crisp
 * result under zoom, so the returned size can be handed straight to `page.drawImage`.
 */
export async function rasterizeText(
  shown: string[],
  options: {
    fontCss: string;
    color: string;
    align: TextAlign;
    widthPt: number;
    lineHeightPt: number;
    scale?: number;
  }
): Promise<{ bytes: Uint8Array; widthPt: number; heightPt: number } | null> {
  if (shown.length === 0 || options.widthPt <= 0) return null;

  const scale = options.scale ?? 4;
  const heightPt = shown.length * options.lineHeightPt;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(options.widthPt * scale));
  canvas.height = Math.max(1, Math.ceil(heightPt * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.font = options.fontCss;
  ctx.fillStyle = options.color;
  ctx.textBaseline = 'top';
  ctx.textAlign = options.align === 'center' ? 'center' : options.align === 'right' ? 'right' : 'left';
  const x = options.align === 'center' ? options.widthPt / 2 : options.align === 'right' ? options.widthPt : 0;
  shown.forEach((line, index) => ctx.fillText(line, x, index * options.lineHeightPt));

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, widthPt: options.widthPt, heightPt };
}

/**
 * Fits `text` to a box on a canvas (see noteFit.ts): shrinks it, or keeps what fits and ends with
 * `continuation`. Null when no canvas is available (the caller falls back to PDF text).
 *
 * Loading the font is usually a no-op by export time (the reader saw the note in it), but a font
 * not yet ready would measure in a fallback face, so it is awaited.
 */
export async function fitOnCanvas(text: string, fontAt: (size: number) => string, o: FitOptions): Promise<FittedText | null> {
  try {
    await Promise.all([document.fonts.load(fontAt(o.size), text), document.fonts.ready]);
  } catch {
    // The canvas falls back to its default face: still better than losing the reader's words.
  }
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  const measure: Measure = (s, size) => {
    ctx.font = fontAt(size);
    return ctx.measureText(s).width;
  };
  return fitText(text, o, measure);
}

/** Never smaller than this in an export (points): small, still readable on paper. */
export const MIN_EXPORT_TEXT_PT = 6;

/**
 * The dash pattern for a stroke, in PDF points.
 *
 * The same ratios `annotationModel`'s `dashArray` uses for the screen, so a dashed or dotted mark
 * exports at the rhythm it was drawn at rather than a visibly different one. Dots are a
 * near-zero dash relying on a round line cap, exactly as they are on screen.
 */
export function dashPattern(style: StrokeStyle | undefined, widthPts: number): number[] | undefined {
  if (style === 'dashed') return [widthPts * 3.5, widthPts * 2.75];
  if (style === 'dotted') return [widthPts * 0.01, widthPts * 2.5];
  return undefined;
}
