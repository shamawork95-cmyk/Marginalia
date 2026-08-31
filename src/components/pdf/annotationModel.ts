/**
 * Marginalia's own annotation model.
 *
 * Owning this is the point of building the viewer rather than adopting one. Because a mark
 * carries its `themeId` directly, colour-coding is a property of the data rather than something
 * inferred from a colour after the fact — and the analysis can create marks programmatically,
 * which is what turns an AI-extracted theme into highlights the reader can step through.
 *
 * GEOMETRY IS STORED IN PAGE FRACTIONS: every x/y/w/h is 0–1 relative to the page box, never a
 * screen pixel. This is the single most important property of the format. The same annotation
 * has to land on the same words when the reader zooms, resizes the window, or reopens the
 * document on a different screen, and pixel coordinates captured at one zoom level survive none
 * of that. Conversion happens once on the way in and once on the way out.
 */

/** Everything the toolbar can draw. */
export type AnnotationKind =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'ink'
  | 'note'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'text';

/** Tools that act on existing marks rather than creating one. */
export type PdfTool = AnnotationKind | 'select' | 'erase';

export interface FractionPoint {
  x: number;
  y: number;
}

export interface FractionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Annotation {
  id: string;
  /** 1-based, matching how pdf.js numbers pages and how readers talk about them. */
  page: number;
  kind: AnnotationKind;
  color: string;
  /** Which theme this mark belongs to, or null when it is not thematic. */
  themeId: string | null;
  /** Text-anchored kinds: one rect per line the selection covered. */
  rects?: FractionRect[];
  /** `ink`: the freehand stroke. */
  points?: FractionPoint[];
  /** `rect`, `ellipse`, `text`, `note`: the mark's box. */
  box?: FractionRect;
  /** `arrow`, `line`: the two endpoints. */
  from?: FractionPoint;
  to?: FractionPoint;
  /**
   * Stroke weight for ink, shapes and lines, as a fraction of PAGE WIDTH.
   *
   * Stored relative to the page so a line keeps its visual weight at any zoom and in an export.
   * It has to be multiplied by the page's rendered pixel width before being handed to SVG,
   * because the strokes use `vector-effect: non-scaling-stroke` — which makes `stroke-width` a
   * screen measurement rather than a viewBox one.
   */
  weight?: number;
  /** The document text the mark covers, captured so search and the notes list can show it. */
  quote?: string;
  /** The reader's own words. */
  text?: string;
  /**
   * `note` only: the passage the note was written about.
   *
   * A sticky note is placed wherever there is room, which is rarely on top of the text it refers
   * to — so the link between the two has to be recorded rather than inferred from position. This
   * is what lets hovering a note light up the passage it belongs to.
   */
  anchorRects?: FractionRect[];
  /** `note` only: pinned in place, so dragging the page cannot nudge it. */
  locked?: boolean;
  author?: string;
  createdAt: string;
}

/** Kinds built from a text selection rather than from dragging on the page. */
export const TEXT_ANCHORED: readonly AnnotationKind[] = ['highlight', 'underline', 'strikeout'];

export function isTextAnchored(kind: AnnotationKind): boolean {
  return TEXT_ANCHORED.includes(kind);
}

/** Kinds drawn by dragging a box out on the page. */
export const BOX_KINDS: readonly AnnotationKind[] = ['rect', 'ellipse', 'text'];

/** Kinds drawn by dragging from one point to another. */
export const LINE_KINDS: readonly AnnotationKind[] = ['arrow', 'line'];

/**
 * A sticky note's default size, as a fraction of the page.
 *
 * Notes occupy real space on the page rather than being a pin with a popup, so they need a size
 * from the moment they are placed — roughly a quarter of the page width and a tenth of its
 * height, which is about the size of a physical sticky note against a page of prose.
 */
export const DEFAULT_NOTE_SIZE = { w: 0.26, h: 0.11 };

/** Ids only have to be unique within one document, so this stays dependency-free. */
export function newAnnotationId(): string {
  return `an-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Converts a viewport rectangle into page fractions.
 *
 * Values are clamped because a selection can extend a hair past the page edge, and a fraction
 * outside 0–1 would draw the mark off the page when it came back.
 */
export function rectToFraction(rect: DOMRect, pageBox: DOMRect): FractionRect {
  const x = clamp01((rect.left - pageBox.left) / pageBox.width);
  const y = clamp01((rect.top - pageBox.top) / pageBox.height);
  return {
    x,
    y,
    w: clamp01((rect.right - pageBox.left) / pageBox.width) - x,
    h: clamp01((rect.bottom - pageBox.top) / pageBox.height) - y
  };
}

export function pointToFraction(clientX: number, clientY: number, pageBox: DOMRect): FractionPoint {
  return {
    x: clamp01((clientX - pageBox.left) / pageBox.width),
    y: clamp01((clientY - pageBox.top) / pageBox.height)
  };
}

/** A box from two corners, in either drag direction. */
export function boxFromPoints(a: FractionPoint, b: FractionPoint): FractionRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y)
  };
}

/** Percentage styles, so a mark is positioned by CSS and needs no recalculation on zoom. */
export function rectStyle(rect: FractionRect): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`
  };
}

/** An SVG polyline `points` attribute for an ink stroke, in a 0–100 viewBox. */
export function pointsToPolyline(points: FractionPoint[]): string {
  return points.map((p) => `${(p.x * 100).toFixed(3)},${(p.y * 100).toFixed(3)}`).join(' ');
}

/** The box that bounds a mark of any kind, for hit-testing and for scrolling to it. */
export function annotationBounds(a: Annotation): FractionRect | null {
  if (a.rects?.length) {
    const x = Math.min(...a.rects.map((r) => r.x));
    const y = Math.min(...a.rects.map((r) => r.y));
    return {
      x,
      y,
      w: Math.max(...a.rects.map((r) => r.x + r.w)) - x,
      h: Math.max(...a.rects.map((r) => r.y + r.h)) - y
    };
  }
  if (a.box) return a.box;
  if (a.from && a.to) return boxFromPoints(a.from, a.to);
  if (a.points?.length) {
    const xs = a.points.map((p) => p.x);
    const ys = a.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return null;
}
