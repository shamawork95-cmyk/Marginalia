/**
 * Exports a copy of the PDF with the reader's marks written in as NATIVE PDF annotations.
 *
 * Native matters: the output carries real `/Highlight`, `/Underline`, `/StrikeOut`, `/Ink`,
 * `/Square`, `/Circle`, `/Line` and `/FreeText` objects, so Preview, Acrobat and any other reader
 * show them as annotations that can be selected, commented on and removed. The alternative —
 * painting marks onto the page — bakes them into the image and cannot be undone.
 *
 * Every kind except highlight/underline/strikeout is ALSO drawn straight onto the page's own
 * content stream, in the same shape, colour and dash rhythm `AnnotationLayer` draws it on screen.
 * That duplication is deliberate: whether a reader ever sees an annotation object drawn correctly
 * depends entirely on the opening application generating its OWN appearance for it, and that
 * varies wildly across viewers — Ink and Square annotations came out invisible in one tested
 * viewer, and FreeText came out as an unstyled, unwrapped default box that swallowed the note's
 * own colour and text. Baking the real appearance into the page content is universally supported;
 * the matching annotation object is then given an intentionally EMPTY appearance stream (`/AP`)
 * so the viewer never draws its own guess on top of, or instead of, what is already correct.
 * Highlight/underline/strikeout are left alone because their QuadPoints-based appearance is
 * generated consistently by every viewer tested, and forcing them onto the same path would only
 * add risk for no gain.
 *
 * The coordinate conversion is the crux. Marks are stored as page fractions with the origin at
 * the TOP-left (how the browser lays out); PDF space is points with the origin at the BOTTOM-left
 * and its own page box. Every value therefore goes through `toPdf`, which flips y and scales by
 * the real MediaBox rather than assuming a page size.
 */

import {
  PDFDocument,
  PDFFont,
  PDFName,
  PDFArray,
  PDFString,
  PDFHexString,
  StandardFonts,
  LineCapStyle,
  rgb
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Annotation, DEFAULT_TEXT_SIZE, FractionRect, StrokeStyle, TextAlign, bracketPoints } from './annotationModel';

/**
 * The reader's own three webfaces, as static TTFs pdf-lib can embed directly.
 *
 * Not the `@fontsource-variable` packages the app's CSS uses: pdf-lib's WOFF2 handling does not
 * fully convert a VARIABLE font's outlines for `/FontFile2` — it was found to silently pass the
 * raw WOFF2 payload through instead, which every PDF reader rejects as garbled or invisible text.
 * These are a one-time flatten of each family's static 400/700, upright/italic instances from the
 * equivalent `@fontsource/*` (non-variable, one static font per weight/style) packages, via
 * `fontTools` in Python:
 *
 * ```python
 * from fontTools.ttLib import TTFont
 * f = TTFont('node_modules/@fontsource/caveat/files/caveat-latin-400-normal.woff2')
 * f.flavor = None  # strip the WOFF2 wrapper, leaving a plain sfnt pdf-lib embeds correctly
 * f.save('src/assets/fonts/Caveat-Regular.ttf')
 * ```
 *
 * repeated for each of the ten weight/style files under `src/assets/fonts`. The `@fontsource/*`
 * (non-variable) packages are not a project dependency — they were only ever a source to flatten
 * from, installed locally for that one-off script and removed again afterwards. Reinstall the
 * relevant one locally to regenerate a file, e.g. if a family is upgraded.
 */
import caveatRegularUrl from '../../assets/fonts/Caveat-Regular.ttf?url';
import caveatBoldUrl from '../../assets/fonts/Caveat-Bold.ttf?url';
import literataRegularUrl from '../../assets/fonts/Literata-Regular.ttf?url';
import literataItalicUrl from '../../assets/fonts/Literata-Italic.ttf?url';
import literataBoldUrl from '../../assets/fonts/Literata-Bold.ttf?url';
import literataBoldItalicUrl from '../../assets/fonts/Literata-BoldItalic.ttf?url';
import plusJakartaRegularUrl from '../../assets/fonts/PlusJakartaSans-Regular.ttf?url';
import plusJakartaItalicUrl from '../../assets/fonts/PlusJakartaSans-Italic.ttf?url';
import plusJakartaBoldUrl from '../../assets/fonts/PlusJakartaSans-Bold.ttf?url';
import plusJakartaBoldItalicUrl from '../../assets/fonts/PlusJakartaSans-BoldItalic.ttf?url';

type HandFamily = 'hand' | 'serif' | 'sans';

/** Caveat has no italic cut of its own — a cursive face slanting further is not a real style. */
const FONT_ASSETS: Record<HandFamily, { normal: string; italic?: string; bold?: string; boldItalic?: string }> = {
  hand: { normal: caveatRegularUrl, bold: caveatBoldUrl },
  serif: {
    normal: literataRegularUrl,
    italic: literataItalicUrl,
    bold: literataBoldUrl,
    boldItalic: literataBoldItalicUrl
  },
  sans: {
    normal: plusJakartaRegularUrl,
    italic: plusJakartaItalicUrl,
    bold: plusJakartaBoldUrl,
    boldItalic: plusJakartaBoldItalicUrl
  }
};

/** Mirrors `AnnotationLayer`'s fallback weight, so an old mark with no weight of its own exports
 *  at the same thickness it draws on screen. */
const DEFAULT_WEIGHT = 0.0028;

/**
 * The base-14 font name for a `FreeText` annotation's `/DA` string — metadata only.
 *
 * The actual glyphs a reader sees are the ones drawn onto the page with the real embedded face
 * (see `textFontFor`/`embeddedFont`); `/DA` just tells a viewer's own annotation sidebar what to
 * fall back to, and sidebars cannot reference an arbitrary embedded font by name — only one of
 * the fourteen every PDF reader has built in. The handwriting face has no counterpart there, so
 * it names the serif it most resembles for that narrow purpose alone.
 */
function freeTextFont(a: Annotation): string {
  const family = a.font === 'mono' ? 'Cour' : a.font === 'sans' ? 'Helv' : 'Times';
  const bold = a.bold ? 'B' : '';
  const italic = a.italic ? (family === 'Times' ? 'I' : 'O') : '';
  if (!bold && !italic) return family === 'Times' ? 'TiRo' : family;
  return `${family}${bold}${italic}`;
}

/** '#rrggbb' to the 0–1 components PDF colour arrays use. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full || '000000', 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** True for colours light enough that dark ink reads better on them than light — the same rule
 *  `AnnotationLayer` uses to pick a solid note's text colour. */
function isDarkFill(r: number, g: number, b: number): boolean {
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.6;
}

/**
 * The dash pattern for a stroke, in PDF points.
 *
 * The same ratios `annotationModel`'s `dashArray` uses for the screen, so a dashed or dotted mark
 * exports at the rhythm it was drawn at rather than a visibly different one. Dots are a
 * near-zero dash relying on a round line cap, exactly as they are on screen.
 */
function dashPattern(style: StrokeStyle | undefined, widthPts: number): number[] | undefined {
  if (style === 'dashed') return [widthPts * 3.5, widthPts * 2.75];
  if (style === 'dotted') return [widthPts * 0.01, widthPts * 2.5];
  return undefined;
}

export async function exportAnnotatedPdf(
  sourceUrl: string,
  annotations: Annotation[],
  fileName: string
): Promise<Blob> {
  const bytes = await (await fetch(sourceUrl)).arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  // Required before embedding anything but the standard 14 — pdf-lib only knows how to parse a
  // custom font's outlines once a fontkit implementation is registered.
  pdfDoc.registerFontkit(fontkit);

  // Notes are always in the app's handwriting face; text boxes carry whichever of the three the
  // reader chose. `mono` keeps a standard font rather than an embedded one — the app's mono stack
  // is the system's own monospace font, so there is no matching bundled asset for it, and Courier
  // already has genuine bold/italic cuts a standard font can offer.
  const embeddedFontCache = new Map<string, PDFFont>();
  const embeddedFont = async (family: HandFamily, bold: boolean, italic: boolean): Promise<PDFFont> => {
    const set = FONT_ASSETS[family];
    const url =
      bold && italic && set.boldItalic
        ? set.boldItalic
        : bold && set.bold
          ? set.bold
          : italic && set.italic
            ? set.italic
            : set.normal;
    const cached = embeddedFontCache.get(url);
    if (cached) return cached;
    const fontBytes = await (await fetch(url)).arrayBuffer();
    const font = await pdfDoc.embedFont(fontBytes);
    embeddedFontCache.set(url, font);
    return font;
  };

  const monoFontCache = new Map<string, PDFFont>();
  const textFontFor = async (a: Annotation): Promise<PDFFont> => {
    const bold = Boolean(a.bold);
    const italic = Boolean(a.italic);
    if (a.font === 'mono') {
      const key = `${bold}-${italic}`;
      const cached = monoFontCache.get(key);
      if (cached) return cached;
      const std =
        bold && italic
          ? StandardFonts.CourierBoldOblique
          : bold
            ? StandardFonts.CourierBold
            : italic
              ? StandardFonts.CourierOblique
              : StandardFonts.Courier;
      const font = await pdfDoc.embedFont(std);
      monoFontCache.set(key, font);
      return font;
    }
    const family: HandFamily = a.font === 'serif' ? 'serif' : a.font === 'hand' ? 'hand' : 'sans';
    return embeddedFont(family, bold, italic);
  };
  const noteFont = await embeddedFont('hand', false, false);

  /** Greedy word wrap to a pixel width, so a note or text box's words stay inside its own box. */
  const wrapText = (font: PDFFont, text: string, size: number, maxWidth: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.split(/\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
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

  /**
   * The border-style dictionary for a stroked mark's ANNOTATION object: its width, and its dash
   * pattern if it has one.
   *
   * This is metadata only — every viewer tested draws its own guess at a stroked annotation's
   * appearance rather than reading `/BS`, which is why the real stroke is also baked onto the
   * page (see the kinds below). Kept anyway because some readers do surface it, e.g. in an
   * annotation's properties panel.
   */
  const borderStyle = (a: Annotation, pageWidth: number, context: any) => {
    const width = Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pageWidth);
    const pattern = dashPattern(a.strokeStyle, width);
    if (pattern) return context.obj({ W: width, S: PDFName.of('D'), D: context.obj(pattern) });
    return context.obj({ W: width });
  };

  const byPage = new Map<number, Annotation[]>();
  for (const a of annotations) {
    const list = byPage.get(a.page);
    if (list) list.push(a);
    else byPage.set(a.page, [a]);
  }

  // A `for...of` rather than `byPage.forEach`, because drawing a `text` mark has to `await` an
  // embedded font — `forEach`'s callback cannot be awaited, so `pdfDoc.save()` below would have
  // run before an async callback's drawing had actually happened.
  for (const [pageNumber, pageAnnotations] of byPage) {
    const page = pages[pageNumber - 1];
    if (!page) continue;

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

    /**
     * A genuinely empty appearance stream, sized to `rect`.
     *
     * Attached as a mark's `/AP` `/N`, this is what stops a viewer from drawing its own default
     * guess at the annotation on top of — or in place of — the real appearance already baked
     * onto the page content below. An annotation carrying one is still fully real: selectable,
     * listed in the sidebar, removable — it simply has nothing left to draw itself.
     */
    const emptyAppearance = (rect: [number, number, number, number]) => {
      const w = Math.max(1, rect[2] - rect[0]);
      const h = Math.max(1, rect[3] - rect[1]);
      const stream = context.formXObject([], {
        Type: PDFName.of('XObject'),
        Subtype: PDFName.of('Form'),
        BBox: context.obj([0, 0, w, h]),
        Matrix: context.obj([1, 0, 0, 1, 0, 0]),
        Resources: context.obj({})
      });
      return context.register(stream);
    };

    const common = (
      a: Annotation,
      rect: [number, number, number, number],
      extra: Record<string, any>,
      opts: { bakedOntoPage?: boolean } = {}
    ) => {
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
      if (opts.bakedOntoPage) dict.AP = context.obj({ N: emptyAppearance(rect) });
      annots.push(context.register(context.obj(dict)));
    };

    /** Draws an open polyline through PDF-space points, stroked the way the screen strokes it. */
    const drawStroke = (points: [number, number][], color: { r: number; g: number; b: number }, widthPts: number, dash?: number[]) => {
      if (points.length < 2) return;
      // pdf-lib's `drawSvgPath` flips the Y axis it is given (SVG is top-down; PDF is
      // bottom-up), so a path point that should land at real PDF point (X, Y) is encoded here
      // as (X, -Y) against a (0, 0) anchor — the flip then cancels back out to (X, Y).
      const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${(-y).toFixed(2)}`).join(' ');
      page.drawSvgPath(d, {
        x: 0,
        y: 0,
        borderColor: rgb(color.r, color.g, color.b),
        borderWidth: widthPts,
        borderDashArray: dash,
        borderLineCap: LineCapStyle.Round
      });
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
        const flat = a.points.map((p) => toPdf(p.x, p.y));
        const xs = a.points.map((p) => p.x);
        const ys = a.points.map((p) => p.y);
        const bounds = rectToPdf({
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys)
        });
        const widthPts = Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pw);
        drawStroke(flat, { r, g, b }, widthPts, dashPattern(a.strokeStyle, widthPts));
        common(
          a,
          bounds,
          {
            Subtype: PDFName.of('Ink'),
            // InkList is a list OF strokes, so a single stroke still nests one level down.
            InkList: context.obj([context.obj(flat.flat())]),
            BS: borderStyle(a, pw, context)
          },
          { bakedOntoPage: true }
        );
        continue;
      }

      if ((a.kind === 'rect' || a.kind === 'ellipse') && a.box) {
        const widthPts = Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pw);
        const dash = dashPattern(a.strokeStyle, widthPts);
        const [x1, y1, x2, y2] = rectToPdf(a.box);
        if (a.kind === 'rect') {
          page.drawRectangle({
            x: x1,
            y: y1,
            width: x2 - x1,
            height: y2 - y1,
            borderColor: rgb(r, g, b),
            borderWidth: widthPts,
            borderDashArray: dash,
            borderLineCap: LineCapStyle.Round
          });
        } else {
          page.drawEllipse({
            x: (x1 + x2) / 2,
            y: (y1 + y2) / 2,
            xScale: (x2 - x1) / 2,
            yScale: (y2 - y1) / 2,
            borderColor: rgb(r, g, b),
            borderWidth: widthPts,
            borderDashArray: dash,
            borderLineCap: LineCapStyle.Round
          });
        }
        common(
          a,
          [x1, y1, x2, y2],
          {
            Subtype: PDFName.of(a.kind === 'rect' ? 'Square' : 'Circle'),
            IC: context.obj([]), // No interior fill: these are outlines, on screen and here.
            BS: borderStyle(a, pw, context)
          },
          { bakedOntoPage: true }
        );
        continue;
      }

      if ((a.kind === 'arrow' || a.kind === 'line') && a.from && a.to) {
        const [x1, y1] = toPdf(a.from.x, a.from.y);
        const [x2, y2] = toPdf(a.to.x, a.to.y);
        const widthPts = Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pw);
        page.drawLine({
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          thickness: widthPts,
          color: rgb(r, g, b),
          dashArray: dashPattern(a.strokeStyle, widthPts),
          lineCap: LineCapStyle.Round
        });
        if (a.kind === 'arrow') {
          // A solid triangle at the far end, never dashed whatever the shaft is — the same rule
          // the on-screen SVG marker follows.
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = widthPts * 3.2;
          const headHalfWidth = widthPts * 1.4;
          const back: [number, number] = [x2 - headLen * Math.cos(angle), y2 - headLen * Math.sin(angle)];
          const left: [number, number] = [
            back[0] - headHalfWidth * Math.sin(angle),
            back[1] + headHalfWidth * Math.cos(angle)
          ];
          const right: [number, number] = [
            back[0] + headHalfWidth * Math.sin(angle),
            back[1] - headHalfWidth * Math.cos(angle)
          ];
          const d = [
            `M ${x2.toFixed(2)} ${(-y2).toFixed(2)}`,
            `L ${left[0].toFixed(2)} ${(-left[1]).toFixed(2)}`,
            `L ${right[0].toFixed(2)} ${(-right[1]).toFixed(2)}`,
            'Z'
          ].join(' ');
          page.drawSvgPath(d, { x: 0, y: 0, color: rgb(r, g, b) });
        }
        common(
          a,
          [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
          {
            Subtype: PDFName.of('Line'),
            L: context.obj([x1, y1, x2, y2]),
            // Line endings: an open arrowhead at the far end, nothing at the near one.
            LE: context.obj([PDFName.of('None'), PDFName.of(a.kind === 'arrow' ? 'OpenArrow' : 'None')]),
            BS: borderStyle(a, pw, context)
          },
          { bakedOntoPage: true }
        );
        continue;
      }

      if (a.kind === 'bracket' && a.box) {
        // PDF has no brace annotation, so the curve is flattened into an `/Ink` stroke — a real
        // annotation every reader understands, rather than paint burned into the page alone. The
        // points come from the same definition the screen draws from, so the exported brace is
        // the exact shape the reader placed, and it is baked onto the page for the same reason
        // every other stroked kind is: an Ink annotation with no `/AP` came out invisible in at
        // least one viewer tested.
        const flat = bracketPoints(a.box, a.bracketSide ?? 'left').map((p) => toPdf(p.x, p.y));
        const widthPts = Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pw);
        const bounds = rectToPdf(a.box);
        drawStroke(flat, { r, g, b }, widthPts, dashPattern(a.strokeStyle, widthPts));
        common(
          a,
          bounds,
          {
            Subtype: PDFName.of('Ink'),
            InkList: context.obj([context.obj(flat.flat())]),
            BS: borderStyle(a, pw, context)
          },
          { bakedOntoPage: true }
        );
        continue;
      }

      if (a.kind === 'text' && a.box) {
        // The reader's own size, converted from a fraction of the page to points — matching
        // `AnnotationLayer`'s own `Math.max(8, …)` floor exactly, so an exported text box comes
        // out the size it looked on screen rather than a size that only agrees at large zooms.
        const size = Math.max(8, (a.fontSize ?? DEFAULT_TEXT_SIZE) * pw);
        const align: TextAlign = a.align ?? 'left';
        const [x1, y1, x2, y2] = rectToPdf(a.box);
        const boxWidth = x2 - x1;
        const boxHeight = y2 - y1;
        const font = await textFontFor(a);
        const lineHeight = size * 1.25;
        const text = (a.text || '').trim();
        if (text) {
          const lines = wrapText(font, text, size, boxWidth);
          const maxLines = Math.max(1, Math.floor(boxHeight / lineHeight));
          lines.slice(0, maxLines).forEach((line, index) => {
            const lineWidth = font.widthOfTextAtSize(line, size);
            const x =
              align === 'center' ? x1 + (boxWidth - lineWidth) / 2 : align === 'right' ? x2 - lineWidth : x1;
            page.drawText(line, {
              x,
              y: y2 - size * 0.85 - index * lineHeight,
              size,
              font,
              color: rgb(r, g, b)
            });
          });
        }
        // `Q` is PDF's quadding: 0 left, 1 centred, 2 right.
        const quadding = align === 'center' ? 1 : align === 'right' ? 2 : 0;
        common(
          a,
          [x1, y1, x2, y2],
          {
            Subtype: PDFName.of('FreeText'),
            // DA is the appearance string a reader's own annotation sidebar falls back to.
            DA: PDFString.of(
              `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg /${freeTextFont(a)} ${size.toFixed(1)} Tf`
            ),
            Q: quadding
          },
          { bakedOntoPage: true }
        );
        continue;
      }

      if (a.kind === 'note' && a.box) {
        const [x1, y1, x2, y2] = rectToPdf(a.box);
        const boxWidth = x2 - x1;
        const boxHeight = y2 - y1;

        // Drawn the way the app draws it, so an exported page is recognisably the same document:
        // paper with a coloured border, flooded with the colour, or tinted so the text below
        // still shows through. Matches `AnnotationLayer`'s `#fffdf5` outline paper and 0.3 tint.
        const noteStyle = a.noteStyle ?? 'outline';
        const fill = noteStyle === 'outline' ? rgb(1, 253 / 255, 245 / 255) : rgb(r, g, b);
        page.drawRectangle({
          x: x1,
          y: y1,
          width: boxWidth,
          height: boxHeight,
          color: fill,
          opacity: noteStyle === 'translucent' ? 0.3 : 1,
          borderColor: rgb(r, g, b),
          borderWidth: 1
        });
        // The heavy left edge — on screen a 5px border distinct from the 1px that runs around the
        // rest of the note, and what makes the colour readable at a glance on the outline style.
        const edge = Math.max(2, Math.min(5, boxWidth * 0.02));
        page.drawRectangle({ x: x1, y: y1, width: edge, height: boxHeight, color: rgb(r, g, b) });

        const text = (a.text || '').trim();
        if (text) {
          // Sized to the note rather than fixed, so a small note gets small text instead of
          // overflowing, then clipped to whatever lines actually fit.
          const size = Math.max(8, Math.min(16, boxHeight / 4.5));
          const lineHeight = size * 1.25;
          const padX = boxWidth * 0.05;
          const padY = boxHeight * 0.04;
          const lines = wrapText(noteFont, text, size, boxWidth - padX * 2 - edge);
          const maxLines = Math.max(1, Math.floor((boxHeight - padY * 2) / lineHeight));
          // Ink chosen against the fill, the same rule the app uses, so a dark note stays
          // readable instead of printing black on near-black.
          const ink = noteStyle === 'solid' && isDarkFill(r, g, b) ? rgb(1, 253 / 255, 245 / 255) : rgb(0.11, 0.09, 0.09);
          lines.slice(0, maxLines).forEach((line, index) => {
            page.drawText(line, {
              x: x1 + edge + padX,
              y: y2 - padY - size * 0.85 - index * lineHeight,
              size,
              font: noteFont,
              color: ink
            });
          });
        }

        // Registered as a real annotation too, so the note is also selectable and its full text
        // readable in a PDF reader's annotation list even when the drawn box had to clip it.
        common(
          a,
          [x1, y1, x2, y2],
          {
            Subtype: PDFName.of('FreeText'),
            DA: PDFString.of(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg /Helv 11 Tf`),
            Q: 0
          },
          { bakedOntoPage: true }
        );
      }
    }

    if (annots.length === 0) continue;

    // Append to any annotations the file already had rather than replacing them.
    const existing = page.node.get(PDFName.of('Annots'));
    if (existing instanceof PDFArray) {
      for (const ref of annots) existing.push(ref);
    } else {
      page.node.set(PDFName.of('Annots'), context.obj(annots));
    }
  }

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
