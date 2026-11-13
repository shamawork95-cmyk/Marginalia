/**
 * Area highlight: a rectangle dragged over a PDF page (a figure, a table, a scan with no text
 * layer). Stored as an ordinary `kind: 'highlight'` PDF annotation with ONE rect and `area: true`,
 * so the existing highlight drawing, annotated-PDF export, search, undo history (historyCore) and
 * page renumbering treat it like any other mark. `area` only tells the UI it was not made from a
 * text selection (no quote; drag handles instead of word snapping). Geometry is page fractions.
 */

import type { Annotation, FractionPoint, FractionRect } from '../components/pdf/annotationModel';

export type AreaHighlight = Annotation & { kind: 'highlight'; area: true; rects: [FractionRect] };

/** Smaller than this on either side (a click, a sliver) is not an area. Page fractions. */
const MIN_SIZE = 0.005;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The page-fraction rect between two drag points, clamped to the page; null when too small. */
export function areaRectFromDrag(a: FractionPoint, b: FractionPoint): FractionRect | null {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  const x1 = clamp01(Math.min(a.x, b.x));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const y2 = clamp01(Math.max(a.y, b.y));
  if (x2 - x1 < MIN_SIZE || y2 - y1 < MIN_SIZE) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export interface NewAreaHighlight {
  /** 1-based. */
  page: number;
  from: FractionPoint;
  to: FractionPoint;
  color: string;
  themeIds: string[];
  /** The reader's note on the area. */
  text?: string;
  author?: string;
}

/** A new area mark, or null for an invalid page or a too-small drag. */
export function createAreaHighlight(
  props: NewAreaHighlight,
  ctx: { now: string; newId: () => string }
): AreaHighlight | null {
  const rect = areaRectFromDrag(props.from, props.to);
  if (!rect || !Number.isInteger(props.page) || props.page < 1) return null;
  const mark: AreaHighlight = {
    id: ctx.newId(),
    page: props.page,
    kind: 'highlight',
    area: true,
    rects: [rect],
    color: props.color,
    themeIds: [...props.themeIds],
    createdAt: ctx.now
  };
  if (props.text) mark.text = props.text;
  if (props.author) mark.author = props.author;
  return mark;
}

export function isAreaHighlight(entry: unknown): entry is AreaHighlight {
  const e = entry as Partial<AreaHighlight> | null;
  return !!e && e.area === true && e.kind === 'highlight' && typeof e.page === 'number' && Array.isArray(e.rects);
}
