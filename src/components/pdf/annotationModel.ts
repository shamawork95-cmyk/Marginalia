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
  | 'bracket'
  | 'text';

/**
 * How a stroked mark is dashed.
 *
 * A dotted rule and a solid one mean different things to a reader working through a text — the
 * usual convention being that a solid mark is a settled judgement and a dotted one is tentative.
 * Carrying it on the mark rather than in a separate legend keeps that meaning with the data.
 */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

/**
 * How a sticky note is filled.
 *
 * `outline` is the original: opaque paper with the theme colour on its border, which keeps
 * handwriting maximally legible. `solid` floods the note with its colour, which makes it carry
 * further at a glance across a page. `translucent` tints it while letting the page show through,
 * for a note that should annotate the text rather than cover it.
 */
export type NoteStyle = 'outline' | 'solid' | 'translucent';

/** Which way a curly bracket opens; it faces the text it gathers. */
export type BracketSide = 'left' | 'right';

/** How a text box's lines are set against its own width. */
export type TextAlign = 'left' | 'center' | 'right';

/**
 * Typefaces a text box can be set in.
 *
 * Deliberately a small named set rather than a free font field. Only faces the app already ships
 * can be guaranteed to render the same on every machine and to survive an export, and a text box
 * that silently falls back to something else on another computer is worse than one that never
 * offered the choice. Each maps to a CSS stack and to one of the fonts every PDF reader has
 * built in — see `exportAnnotatedPdf`.
 */
export type TextFont = 'serif' | 'sans' | 'mono' | 'hand';

export const TEXT_FONTS: { value: TextFont; label: string; stack: string }[] = [
  { value: 'serif', label: 'Serif', stack: "'Literata Variable', Literata, Georgia, serif" },
  { value: 'sans', label: 'Sans', stack: "'Plus Jakarta Sans Variable', system-ui, sans-serif" },
  { value: 'mono', label: 'Mono', stack: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  { value: 'hand', label: 'Hand', stack: "'Caveat Variable', Caveat, 'Patrick Hand', cursive" }
];

export function fontStack(font: TextFont | undefined): string {
  return TEXT_FONTS.find((f) => f.value === (font ?? 'sans'))?.stack ?? TEXT_FONTS[1].stack;
}

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
  /** `rect`, `ellipse`, `text`, `note`, `bracket`: the mark's box. */
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
  /** Stroked kinds: solid, dashed or dotted. Absent means solid, which is what older marks are. */
  strokeStyle?: StrokeStyle;
  /** `note` only: filled, tinted, or bordered paper. Absent means `outline`, the original look. */
  noteStyle?: NoteStyle;
  /** `bracket` only: which way the brace opens. Absent means `left`, a `{`. */
  bracketSide?: BracketSide;
  /**
   * `text` only: type size, as a fraction of PAGE WIDTH.
   *
   * Relative to the page for the same reason stroke weight is: a text box written at one zoom
   * has to come back the same size at another, and land at that size in an export. A size in
   * screen pixels survives none of that.
   */
  fontSize?: number;
  /** `text` only: how its lines are set. Absent means `left`. */
  align?: TextAlign;
  /** `text` only: which typeface. Absent means `sans`. */
  font?: TextFont;
  bold?: boolean;
  italic?: boolean;
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
export const BOX_KINDS: readonly AnnotationKind[] = ['rect', 'ellipse', 'text', 'bracket'];

/** Kinds drawn by dragging from one point to another. */
export const LINE_KINDS: readonly AnnotationKind[] = ['arrow', 'line'];

/** Kinds stroked with a pen rather than filled, and so the only ones with a dash pattern. */
export const STROKED_KINDS: readonly AnnotationKind[] = [
  'ink',
  'rect',
  'ellipse',
  'arrow',
  'line',
  'bracket',
  'underline',
  'strikeout'
];

export function isStroked(kind: AnnotationKind): boolean {
  return STROKED_KINDS.includes(kind);
}

/**
 * Kinds the reader can pick up and move around the page.
 *
 * Text-anchored marks are deliberately excluded. A highlight means "these words", and its
 * geometry is a record of where those words were — dragging one somewhere else would leave a
 * mark whose position contradicts the passage it claims to cover. Everything the reader drew
 * themselves, on the other hand, was placed by eye and should be adjustable by eye.
 */
export const MOVABLE_KINDS: readonly AnnotationKind[] = [
  'ink',
  'rect',
  'ellipse',
  'arrow',
  'line',
  'bracket',
  'note',
  'text'
];

export function isMovable(a: Annotation): boolean {
  return MOVABLE_KINDS.includes(a.kind) && !a.locked;
}

/**
 * A sticky note's default size, as a fraction of the page.
 *
 * Notes occupy real space on the page rather than being a pin with a popup, so they need a size
 * from the moment they are placed — roughly a quarter of the page width and a tenth of its
 * height, which is about the size of a physical sticky note against a page of prose.
 */
export const DEFAULT_NOTE_SIZE = { w: 0.26, h: 0.11 };

/**
 * Type sizes offered for a text box, as fractions of page width.
 *
 * Four steps rather than a free numeric field: the point of a text box is a remark in the margin,
 * and the choice that matters is roughly how loud it should be, not whether it is 13 or 14 point.
 */
export const TEXT_SIZE_STEPS: { label: string; value: number }[] = [
  { label: 'Small', value: 0.018 },
  { label: 'Medium', value: 0.024 },
  { label: 'Large', value: 0.032 },
  { label: 'Extra large', value: 0.044 }
];

export const DEFAULT_TEXT_SIZE = 0.024;

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

/**
 * The dash pattern for a stroke, in the same units as its width.
 *
 * Proportional to the stroke weight, not a fixed measurement, and that is what makes the styles
 * actually distinguishable. `vector-effect: non-scaling-stroke` makes the width a SCREEN
 * measurement, and the dash array is measured in that same space — so a pattern expressed in
 * viewBox units comes out a pixel or two long against a stroke two pixels wide, which reads as a
 * solid line with a faint texture rather than as dashes. Tying both to one number keeps the gaps
 * open at every weight and every zoom.
 *
 * Dots are a near-zero dash relying on the round line cap, which is what makes them round rather
 * than square.
 */
export function dashArray(style: StrokeStyle | undefined, widthPx: number): string | undefined {
  if (style === 'dashed') return `${(widthPx * 3.5).toFixed(2)} ${(widthPx * 2.75).toFixed(2)}`;
  if (style === 'dotted') return `${(widthPx * 0.01).toFixed(3)} ${(widthPx * 2.5).toFixed(2)}`;
  return undefined;
}

/**
 * The path of a curly bracket spanning a box.
 *
 * Built from four quadratic curves — two arms and the two halves of the central point — which is
 * the shape a brace actually has: it narrows to a point at the middle rather than being a bracket
 * with a bump. Coordinates are in the layer's 0–100 viewBox, so a brace scales with the page like
 * every other mark.
 */
export function bracketPath(box: FractionRect, side: BracketSide = 'left'): string {
  const x0 = box.x * 100;
  const x1 = (box.x + box.w) * 100;
  const y0 = box.y * 100;
  const y1 = (box.y + box.h) * 100;
  const midY = (y0 + y1) / 2;

  // The spine runs down the side the arms curl away from; the point reaches across to the other.
  const spine = side === 'left' ? x1 : x0;
  const tip = side === 'left' ? x0 : x1;
  const stem = (spine + tip) / 2;

  // Arms occupy the outer quarter of the height, leaving the middle half to taper to the point.
  const armY = y0 + (y1 - y0) * 0.22;
  const armY2 = y1 - (y1 - y0) * 0.22;

  return [
    `M ${spine.toFixed(3)} ${y0.toFixed(3)}`,
    `Q ${stem.toFixed(3)} ${y0.toFixed(3)} ${stem.toFixed(3)} ${armY.toFixed(3)}`,
    `L ${stem.toFixed(3)} ${(midY - (midY - armY) * 0.35).toFixed(3)}`,
    `Q ${stem.toFixed(3)} ${midY.toFixed(3)} ${tip.toFixed(3)} ${midY.toFixed(3)}`,
    `Q ${stem.toFixed(3)} ${midY.toFixed(3)} ${stem.toFixed(3)} ${(midY + (armY2 - midY) * 0.35).toFixed(3)}`,
    `L ${stem.toFixed(3)} ${armY2.toFixed(3)}`,
    `Q ${stem.toFixed(3)} ${y1.toFixed(3)} ${spine.toFixed(3)} ${y1.toFixed(3)}`
  ].join(' ');
}

/**
 * Moves a mark by a delta in page fractions, whatever geometry it happens to use.
 *
 * Returns a patch rather than a new annotation so it can go straight through the same
 * `updateAnnotation` path every other edit uses — which is what puts a drag on the undo stack
 * alongside everything else.
 */
export function translateAnnotation(a: Annotation, dx: number, dy: number): Partial<Annotation> {
  const clampBox = (b: FractionRect): FractionRect => ({
    // Clamped so a mark cannot be dragged off the paper and lost; its size is preserved, which
    // is why the limit is `1 - w` rather than `1`.
    x: Math.min(Math.max(b.x + dx, 0), Math.max(0, 1 - b.w)),
    y: Math.min(Math.max(b.y + dy, 0), Math.max(0, 1 - b.h)),
    w: b.w,
    h: b.h
  });

  if (a.box) return { box: clampBox(a.box) };

  if (a.from && a.to) {
    // Lines move as a rigid pair: the shift is trimmed to whatever keeps BOTH ends on the page,
    // so dragging one end into the margin cannot silently shorten the line.
    const minX = Math.min(a.from.x, a.to.x);
    const maxX = Math.max(a.from.x, a.to.x);
    const minY = Math.min(a.from.y, a.to.y);
    const maxY = Math.max(a.from.y, a.to.y);
    const tx = Math.min(Math.max(dx, -minX), 1 - maxX);
    const ty = Math.min(Math.max(dy, -minY), 1 - maxY);
    return {
      from: { x: a.from.x + tx, y: a.from.y + ty },
      to: { x: a.to.x + tx, y: a.to.y + ty }
    };
  }

  if (a.points?.length) {
    const minX = Math.min(...a.points.map((p) => p.x));
    const maxX = Math.max(...a.points.map((p) => p.x));
    const minY = Math.min(...a.points.map((p) => p.y));
    const maxY = Math.max(...a.points.map((p) => p.y));
    const tx = Math.min(Math.max(dx, -minX), 1 - maxX);
    const ty = Math.min(Math.max(dy, -minY), 1 - maxY);
    return { points: a.points.map((p) => ({ x: p.x + tx, y: p.y + ty })) };
  }

  return {};
}

/** The smallest a mark may be scaled to, so it never becomes too small to grab again. */
const MIN_EXTENT = 0.012;

/**
 * Rescales a mark so its bounding box becomes `next`, remapping whatever geometry it holds.
 *
 * Every kind is handled by the same proportional map from the old bounds to the new, which is why
 * a freehand stroke and a rectangle can share one set of resize handles — each of a stroke's
 * points moves the same way the corners of a box would.
 */
export function scaleAnnotation(
  a: Annotation,
  from: FractionRect,
  next: FractionRect
): Partial<Annotation> {
  const target: FractionRect = {
    x: next.x,
    y: next.y,
    w: Math.max(next.w, MIN_EXTENT),
    h: Math.max(next.h, MIN_EXTENT)
  };
  // A zero-width source (a perfectly vertical line, a flat stroke) has no ratio to scale by, so
  // its points are carried across unchanged on that axis rather than divided by zero.
  const sx = from.w > 1e-6 ? target.w / from.w : 0;
  const sy = from.h > 1e-6 ? target.h / from.h : 0;
  const mapX = (x: number) => target.x + (from.w > 1e-6 ? (x - from.x) * sx : target.w / 2);
  const mapY = (y: number) => target.y + (from.h > 1e-6 ? (y - from.y) * sy : target.h / 2);

  if (a.box) return { box: target };
  if (a.from && a.to) {
    return {
      from: { x: mapX(a.from.x), y: mapY(a.from.y) },
      to: { x: mapX(a.to.x), y: mapY(a.to.y) }
    };
  }
  if (a.points?.length) {
    return { points: a.points.map((p) => ({ x: mapX(p.x), y: mapY(p.y) })) };
  }
  return {};
}

/**
 * A curly bracket flattened into a polyline, in page fractions.
 *
 * The export writes brackets as native `/Ink` annotations, which take a list of points rather
 * than a path — so the same curve the screen draws with quadratics is sampled here. Keeping both
 * from one definition is what stops an exported brace from being a subtly different shape to the
 * one the reader placed.
 */
export function bracketPoints(box: FractionRect, side: BracketSide = 'left', perCurve = 8): FractionPoint[] {
  const x0 = box.x;
  const x1 = box.x + box.w;
  const y0 = box.y;
  const y1 = box.y + box.h;
  const midY = (y0 + y1) / 2;
  const spine = side === 'left' ? x1 : x0;
  const tip = side === 'left' ? x0 : x1;
  const stem = (spine + tip) / 2;
  const armY = y0 + (y1 - y0) * 0.22;
  const armY2 = y1 - (y1 - y0) * 0.22;

  const quad = (
    a: FractionPoint,
    control: FractionPoint,
    b: FractionPoint
  ): FractionPoint[] => {
    const out: FractionPoint[] = [];
    for (let i = 1; i <= perCurve; i++) {
      const t = i / perCurve;
      const u = 1 - t;
      out.push({
        x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * control.y + t * t * b.y
      });
    }
    return out;
  };

  const p = (x: number, y: number): FractionPoint => ({ x, y });
  const start = p(spine, y0);
  const upperArmEnd = p(stem, armY);
  const upperStemEnd = p(stem, midY - (midY - armY) * 0.35);
  const point = p(tip, midY);
  const lowerStemStart = p(stem, midY + (armY2 - midY) * 0.35);
  const lowerArmStart = p(stem, armY2);
  const end = p(spine, y1);

  return [
    start,
    ...quad(start, p(stem, y0), upperArmEnd),
    upperStemEnd,
    ...quad(upperStemEnd, p(stem, midY), point),
    ...quad(point, p(stem, midY), lowerStemStart),
    lowerArmStart,
    ...quad(lowerArmStart, p(stem, y1), end)
  ];
}

/**
 * The end point of a drag, constrained to a "clean" shape — what holding Shift while drawing
 * gives you in every drawing application.
 *
 * The constraint is applied in PIXELS, not in page fractions, and that is the whole subtlety. A
 * page is taller than it is wide, so equal fractional deltas are not a square on screen and equal
 * fractional slopes are not 45 degrees; constraining in fraction space produces shapes that are
 * demonstrably wrong in exactly the way the reader was trying to avoid. The result converts back
 * to fractions once the shape is settled.
 */
export function constrainToShape(
  start: FractionPoint,
  end: FractionPoint,
  pageWidthPx: number,
  pageHeightPx: number,
  mode: 'box' | 'line'
): FractionPoint {
  const dx = (end.x - start.x) * pageWidthPx;
  const dy = (end.y - start.y) * pageHeightPx;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));

  if (mode === 'line') {
    // Snapped to the nearest eighth-turn, so horizontal, vertical and true diagonals are all
    // reachable — the three a reader ruling a margin actually wants.
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const length = Math.hypot(dx, dy);
    return {
      x: clamp(start.x + (Math.cos(angle) * length) / pageWidthPx),
      y: clamp(start.y + (Math.sin(angle) * length) / pageHeightPx)
    };
  }

  // A square, or a circle: equal side lengths on screen, keeping the direction the drag went.
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: clamp(start.x + ((dx < 0 ? -1 : 1) * side) / pageWidthPx),
    y: clamp(start.y + ((dy < 0 ? -1 : 1) * side) / pageHeightPx)
  };
}

/**
 * How much of a rectangle is already covered by others, as a fraction of its width.
 *
 * Used to decide whether a passage the reader has selected is already marked. Only rectangles on
 * the same LINE count — vertical overlap of more than half the line's height — because text marks
 * are one rectangle per line and a rectangle two lines below covers none of this one however much
 * their horizontal ranges happen to coincide.
 */
export function coveredFraction(rect: FractionRect, others: FractionRect[]): number {
  if (rect.w <= 0) return 1;
  const spans: Array<[number, number]> = [];
  for (const other of others) {
    const overlap = Math.min(rect.y + rect.h, other.y + other.h) - Math.max(rect.y, other.y);
    if (overlap <= Math.min(rect.h, other.h) * 0.5) continue;
    const left = Math.max(rect.x, other.x);
    const right = Math.min(rect.x + rect.w, other.x + other.w);
    if (right > left) spans.push([left, right]);
  }
  if (spans.length === 0) return 0;

  // Merged before measuring, so two marks overlapping each other are not counted twice and made
  // to look like more coverage than there is.
  spans.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let [start, end] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s > end) {
      covered += end - start;
      [start, end] = [s, e];
    } else if (e > end) {
      end = e;
    }
  }
  covered += end - start;
  return covered / rect.w;
}
