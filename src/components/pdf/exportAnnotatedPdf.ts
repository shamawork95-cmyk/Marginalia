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
 * and its own page box. Every value therefore goes through `toPdf` (see `pageBox.ts`), which flips
 * y and scales by the page's visible CropBox, offset included, rather than assuming a page size.
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
  degrees,
  rgb
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  Annotation,
  DEFAULT_TEXT_SIZE,
  FractionRect,
  TextAlign,
  bracketPoints,
  fontStack,
  isReaction,
  reactionChar
} from './annotationModel';
import { pageTransform } from './pageBox';
import { fitText, type FitOptions } from './noteFit';

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
import {
  freeTextFont,
  hexToRgb,
  isDarkFill,
  MIN_EXPORT_TEXT_PT,
  dashPattern,
  fitOnCanvas,
  rasterizeText
} from './export/exportText';
import { appendNotesPages } from './export/exportExtras';

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


export async function exportAnnotatedPdf(
  sourceUrl: string,
  annotations: Annotation[],
  fileName: string,
  /** Live colour for `isTerminology` marks — see `Annotation.isTerminology`'s doc comment. */
  terminologyColor: string
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

  /** Bold Helvetica for reaction glyphs (?, *, !) — a fixed face, since these are marks, not prose. */
  let reactionFontPromise: Promise<PDFFont> | null = null;
  const reactionFont = () => (reactionFontPromise ??= pdfDoc.embedFont(StandardFonts.HelveticaBold));

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

  /**
   * Notes and text boxes whose words did not fit even at the smallest size: printed in full on
   * "Notes continued" pages appended at the end. Their boxes end with a pointer to that page.
   */
  const continued: { page: number; label: string; text: string }[] = [];
  const notesPage = pages.length + 1;
  const continuation = `… continued in Notes, p. ${notesPage}`;

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

    // Visible box (CropBox within MediaBox) with its offset, rotation applied — see pageBox.ts.
    // `pw` is the VISUAL width every width/weight fraction in the model is relative to.
    const { rotation, pw, toPdf } = pageTransform(page);
    const rectToPdf = (r: FractionRect): [number, number, number, number] => {
      const [ax, ay] = toPdf(r.x, r.y + r.h);
      const [bx, by] = toPdf(r.x + r.w, r.y);
      // Rotation can swap which visual corner ends up the native min or max on either axis — a
      // rectangle stays axis-aligned under a 90-degree-multiple rotation, but which of these two
      // opposite corners is smaller does not, so the two are min/max-ed rather than assumed.
      return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    };

    /**
     * How to turn anything drawn onto the content stream so it faces the reader.
     *
     * `toPdf` puts geometry in the right PLACE on a `/Rotate` page, but a glyph or an image is
     * drawn upright in the page's native space — which is what the viewer then rotates. On a
     * 90-degree page that left every reaction glyph and every line of note text lying on its
     * side. Turning them the other way cancels the viewer's rotation out.
     *
     * The anchor moves with it: pdf-lib rotates about the draw origin, so on a rotated page the
     * x/y a caller computed as "bottom-left" is no longer the corner the content grows away from.
     * `anchorFor` returns the corner to pass for a given native rectangle.
     */
    const contentRotation = degrees((360 - rotation) % 360);
    const anchorFor = (x1: number, y1: number, x2: number, y2: number): [number, number] => {
      switch (rotation) {
        case 90:
          return [x2, y1];
        case 180:
          return [x2, y2];
        case 270:
          return [x1, y2];
        default:
          return [x1, y1];
      }
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
        // A terminology mark ignores its own stored colour in favour of the live setting, exactly
        // as TextMarkLayer does on screen — see `Annotation.isTerminology`.
        const withEffectiveColor = a.isTerminology ? { ...a, color: terminologyColor } : a;
        common(withEffectiveColor, bounds, {
          Subtype: PDFName.of(
            a.kind === 'highlight' ? 'Highlight' : a.kind === 'underline' ? 'Underline' : 'StrikeOut'
          ),
          QuadPoints: context.obj(quads),
          // Without `CA`, a viewer's default-generated appearance for a Highlight paints the
          // colour fully opaque — a flat, saturated block that buries the text under it. On
          // screen, TextMarkLayer renders the same fill at 38% opacity with a multiply blend
          // (see AnnotationLayer.tsx) precisely so the tint stays a highlighter-style wash rather
          // than a solid rectangle; `CA` is the PDF annotation model's equivalent lever, and
          // `BM: Multiply` asks any viewer that honours blend modes to match the multiply too.
          // Underline/strikeout are left untouched: on screen those are a thin full-colour line,
          // not a filled tint, so there is nothing to reconcile.
          ...(a.kind === 'highlight' ? { CA: 0.38, BM: PDFName.of('Multiply') } : {}),
          // Thickness and dash pattern, which the reader sets on every underline and strikeout
          // from the properties strip. Without this the viewer draws its own default hairline
          // and a Heavy Dotted underline exports as a thin solid one.
          ...(a.kind === 'highlight' ? {} : { BS: borderStyle(withEffectiveColor, pw, context) })
        });

        // …and drawn onto the page as well, because no viewer tested honours `/BS` on an
        // Underline or StrikeOut — it generates its own appearance from `QuadPoints` alone. The
        // rule is baked at the same fraction of the line box the screen uses (92% for an
        // underline, 52% for a strikeout) so the exported mark sits exactly where it was made.
        if (a.kind !== 'highlight') {
          const ink = hexToRgb(withEffectiveColor.color);
          const widthPts = Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pw);
          const dash = dashPattern(a.strokeStyle, widthPts);
          const offset = a.kind === 'underline' ? 0.92 : 0.52;
          for (const rect of a.rects) {
            const [x1, , x2] = rectToPdf(rect);
            // Fractions run top-down; the y of the rule is that many line-heights below the
            // rect's top edge, converted through the same transform as everything else.
            const [, ruleY] = rectToPdf({ x: rect.x, y: rect.y + rect.h * offset, w: 0, h: 0 });
            drawStroke(
              [
                [x1, ruleY],
                [x2, ruleY]
              ],
              ink,
              widthPts,
              dash
            );
          }
        }
        continue;
      }

      if (isReaction(a.kind) && a.box) {
        // A single glyph centred in its own box, sized from `fontSize` the same way a text box
        // is — matching AnnotationLayer's on-screen badge, which the reader may have dragged or
        // resized away from where the passage that made it originally sat.
        const [x1, y1, x2, y2] = rectToPdf(a.box);
        const char = reactionChar(a.kind);
        const size = Math.max(8, (a.fontSize ?? DEFAULT_TEXT_SIZE) * pw);
        const font = await reactionFont();
        // Centred on the CAP HEIGHT, not the em box. `y1 + (h - size) / 2` centres the box the
        // glyph sits in, which leaves the visible mark about 0.15em low — the descender space is
        // empty for `?`, `*` and `!`. Roughly 0.7 of the size is cap height for these faces.
        const capHeight = size * 0.7;
        // Centred on the box either way, but on a rotated page the glyph is turned to face the
        // reader and drawn from the corner it grows away from once turned.
        const glyphW = font.widthOfTextAtSize(char, size);
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const [gx, gy] =
          rotation === 90
            ? [cx + capHeight / 2, cy - glyphW / 2]
            : rotation === 180
              ? [cx + glyphW / 2, cy + capHeight / 2]
              : rotation === 270
                ? [cx - capHeight / 2, cy + glyphW / 2]
                : [cx - glyphW / 2, cy - capHeight / 2];
        page.drawText(char, {
          x: gx,
          y: gy,
          size,
          font,
          color: rgb(r, g, b),
          rotate: contentRotation
        });
        common(
          a,
          [x1, y1, x2, y2],
          {
            Subtype: PDFName.of('FreeText'),
            DA: PDFString.of(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg /HelvB ${size.toFixed(1)} Tf`)
          },
          { bakedOntoPage: true }
        );
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
            // A mask covers what is under it; every other box is an outline.
            ...(a.filled ? { color: rgb(r, g, b) } : {}),
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
            // Interior colour only for a mask; the other boxes are outlines, on screen and here.
            IC: a.kind === 'rect' && a.filled ? context.obj([r, g, b]) : context.obj([]),
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
          // Matched to the on-screen marker rather than guessed: it is a 4x4 box in stroke-width
          // units (`markerUnits="strokeWidth"`), so the head is 4 widths long and 4 wide — and
          // its `refX=3` puts the tip one width PAST the line's end. The exported head was 3.2
          // long and 2.8 wide, ending exactly at the line, which read as visibly smaller.
          const headLen = widthPts * 4;
          const headHalfWidth = widthPts * 2;
          const tipX = x2 + widthPts * Math.cos(angle);
          const tipY = y2 + widthPts * Math.sin(angle);
          const back: [number, number] = [tipX - headLen * Math.cos(angle), tipY - headLen * Math.sin(angle)];
          const left: [number, number] = [
            back[0] - headHalfWidth * Math.sin(angle),
            back[1] + headHalfWidth * Math.cos(angle)
          ];
          const right: [number, number] = [
            back[0] + headHalfWidth * Math.sin(angle),
            back[1] - headHalfWidth * Math.cos(angle)
          ];
          const d = [
            `M ${tipX.toFixed(2)} ${(-tipY).toFixed(2)}`,
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
        const text = (a.text || '').trim();
        if (text) {
          const bold = a.bold ? 'bold ' : '';
          const italic = a.italic ? 'italic ' : '';
          const fontAt = (s: number) => `${italic}${bold}${s}px ${fontStack(a.font)}`;
          // Shrunk to fit, never cut (noteFit.ts): what still runs over goes to the notes page.
          const fitOpts: FitOptions = { widthPt: boxWidth, heightPt: boxHeight, size, minSize: Math.min(size, MIN_EXPORT_TEXT_PT), lineFactor: 1.25, continuation };
          const fitted = await fitOnCanvas(text, fontAt, fitOpts);
          if (fitted?.overflow) continued.push({ page: pageNumber, label: 'Text box', text });
          const rasterized = fitted
            ? await rasterizeText(fitted.lines, {
                fontCss: fontAt(fitted.size),
                color: a.color,
                align,
                widthPt: boxWidth,
                lineHeightPt: fitted.lineHeight
              })
            : null;
          if (rasterized) {
            const image = await pdfDoc.embedPng(rasterized.bytes);
            const [ix, iy] = anchorFor(x1, y2 - rasterized.heightPt, x1 + rasterized.widthPt, y2);
            page.drawImage(image, {
              x: ix,
              y: iy,
              width: rasterized.widthPt,
              height: rasterized.heightPt,
              rotate: contentRotation
            });
          } else {
            // Canvas rasterization is unavailable — fall back to native PDF text rather than
            // silently dropping the reader's words.
            const font = await textFontFor(a);
            const fit = fitText(text, fitOpts, (s, sz) => font.widthOfTextAtSize(s, sz));
            if (fit.overflow && !fitted) continued.push({ page: pageNumber, label: 'Text box', text });
            fit.lines.forEach((line, index) => {
              const lineWidth = font.widthOfTextAtSize(line, fit.size);
              const x =
                align === 'center' ? x1 + (boxWidth - lineWidth) / 2 : align === 'right' ? x2 - lineWidth : x1;
              page.drawText(line, {
                x,
                y: y2 - fit.size * 0.85 - index * fit.lineHeight,
                rotate: contentRotation,
                size: fit.size,
                font,
                color: rgb(r, g, b)
              });
            });
          }
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
        // Native-left is only the reader's left on an unrotated page; on a 90-degree page it is
        // the top, and the spine has to follow the side the reader actually sees it on.
        const spine =
          rotation === 90
            ? { x: x1, y: y2 - edge, width: boxWidth, height: edge }
            : rotation === 180
              ? { x: x2 - edge, y: y1, width: edge, height: boxHeight }
              : rotation === 270
                ? { x: x1, y: y1, width: boxWidth, height: edge }
                : { x: x1, y: y1, width: edge, height: boxHeight };
        page.drawRectangle({ ...spine, color: rgb(r, g, b) });

        const text = (a.text || '').trim();
        if (text) {
          // Sized to the note rather than fixed, so a small note starts with small text; it then
          // shrinks further to fit, and anything still over goes to the notes page (never cut).
          const size = Math.max(8, Math.min(16, boxHeight / 4.5));
          const padX = boxWidth * 0.05;
          // Both paddings measured against the WIDTH, because that is what the screen's
          // `padding: '4% 5%'` does — a percentage padding resolves against the containing
          // block's width on both axes.
          const padY = boxWidth * 0.04;
          const textWidth = boxWidth - padX * 2 - edge;
          const fontAt = (s: number) => `${s}px ${fontStack('hand')}`;
          // Shrunk to fit, never cut (noteFit.ts): what still runs over goes to the notes page.
          const fitOpts: FitOptions = { widthPt: textWidth, heightPt: boxHeight - padY * 2, size, minSize: Math.min(size, MIN_EXPORT_TEXT_PT), lineFactor: 1.25, continuation };
          const fitted = await fitOnCanvas(text, fontAt, fitOpts);
          if (fitted?.overflow) continued.push({ page: pageNumber, label: 'Sticky note', text });
          // Ink chosen against the fill, the same rule `AnnotationLayer` uses (and the same exact
          // hex values), so a dark note stays readable instead of printing black on near-black.
          const inkHex = noteStyle === 'solid' && isDarkFill(r, g, b) ? '#fffdf5' : '#1c1917';
          const rasterized = fitted
            ? await rasterizeText(fitted.lines, {
                fontCss: fontAt(fitted.size),
                color: inkHex,
                align: 'left',
                widthPt: textWidth,
                lineHeightPt: fitted.lineHeight
              })
            : null;
          if (rasterized) {
            const image = await pdfDoc.embedPng(rasterized.bytes);
            const [nx, ny] = anchorFor(
              x1 + edge + padX,
              y2 - padY - rasterized.heightPt,
              x1 + edge + padX + rasterized.widthPt,
              y2 - padY
            );
            page.drawImage(image, {
              x: nx,
              y: ny,
              width: rasterized.widthPt,
              height: rasterized.heightPt,
              rotate: contentRotation
            });
          } else {
            // Canvas rasterization is unavailable — fall back to native PDF text rather than
            // silently dropping the reader's words.
            const ink = noteStyle === 'solid' && isDarkFill(r, g, b) ? rgb(1, 253 / 255, 245 / 255) : rgb(0.11, 0.09, 0.09);
            const fit = fitText(text, fitOpts, (s, sz) => noteFont.widthOfTextAtSize(s, sz));
            if (fit.overflow && !fitted) continued.push({ page: pageNumber, label: 'Sticky note', text });
            fit.lines.forEach((line, index) => {
              page.drawText(line, {
                x: x1 + edge + padX,
                y: y2 - padY - fit.size * 0.85 - index * fit.lineHeight,
                rotate: contentRotation,
                size: fit.size,
                font: noteFont,
                color: ink
              });
            });
          }
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

  if (continued.length) await appendNotesPages(pdfDoc, continued, pages[0]?.getSize());

  const out = await pdfDoc.save();
  void fileName;
  return new Blob([out as unknown as BlobPart], { type: 'application/pdf' });
}


// Imported from here by the workspace.
export { downloadBlob } from './export/exportExtras';
