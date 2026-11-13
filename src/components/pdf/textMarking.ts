/**
 * Turning a PDF text selection into marks: the pure part of `useTextMarking`, so it is tested.
 *
 * A selection arrives as one group per page (its line rectangles and its own words). Marking adds
 * and never toggles: a page already carrying the same kind of mark under every chosen theme is
 * skipped, and a mark already on those words gets the chosen themes it lacks (one passage, several
 * themes) instead of a second mark.
 */

import { coveredFraction, newAnnotationId, type Annotation, type AnnotationKind, type FractionRect } from './annotationModel';
import { unionThemeIds } from '../../utils/markThemes';

export interface SelectionGroup {
  page: number;
  rects: FractionRect[];
  quote: string;
}

/**
 * Whether a page's part of a selection already carries a mark of this kind and flag, under every theme asked for.
 * Every line has to be substantially covered (80%): a selection's rectangles run a hair wider than
 * the glyphs they contain, and a re-selection rarely reproduces the first one to the character.
 */
export function isAlreadyMarked(
  annotations: Annotation[],
  group: { page: number; rects: FractionRect[] },
  kind: AnnotationKind,
  isTerminology = false,
  /** Marked "already" only by marks that carry every one of these themes. Empty: any such mark. */
  themeIds: readonly string[] = []
): boolean {
  const existing = sameKind(annotations, group.page, kind, isTerminology)
    .filter((a) => themeIds.every((t) => a.themeIds?.includes(t)))
    .flatMap((a) => a.rects!);
  if (existing.length === 0) return false;
  return covers(existing, group.rects);
}

const sameKind = (annotations: Annotation[], page: number, kind: AnnotationKind, isTerminology: boolean) =>
  annotations.filter((a) => a.kind === kind && Boolean(a.isTerminology) === isTerminology && a.page === page && a.rects?.length);

const covers = (existing: FractionRect[], rects: FractionRect[]) => rects.every((rect) => coveredFraction(rect, existing) >= 0.8);

export interface MarkPlan {
  /** New marks, one per page not marked this way yet. */
  created: Annotation[];
  /**
   * Marks already on these words that get the selection's themes added (one passage, several
   * themes): their new theme list, and the colour when the mark had no theme before.
   */
  tagged: { id: string; themeIds: string[]; color?: string }[];
}

/**
 * What marking a selection does, page by page. Words already marked this way under every chosen
 * theme: nothing. Words one mark of this kind already covers: that mark gets the missing themes.
 * Otherwise a new mark under all the chosen themes.
 */
export function planTextMarks(
  annotations: Annotation[],
  groups: SelectionGroup[],
  o: {
    kind: AnnotationKind;
    isTerminology: boolean;
    themeIds: readonly string[];
    color: string;
    weight?: number;
    author: string;
    now?: string;
    newId?: () => string;
  }
): MarkPlan {
  const now = o.now ?? new Date().toISOString();
  const newId = o.newId ?? newAnnotationId;
  const plan: MarkPlan = { created: [], tagged: [] };
  for (const g of groups) {
    if (isAlreadyMarked(annotations, g, o.kind, o.isTerminology, o.themeIds)) continue;
    const host = sameKind(annotations, g.page, o.kind, o.isTerminology).find((a) => covers(a.rects!, g.rects));
    if (host) {
      const before = host.themeIds ?? [];
      const entry: MarkPlan['tagged'][number] = { id: host.id, themeIds: unionThemeIds(before, o.themeIds) };
      if (before.length === 0 && !o.isTerminology) entry.color = o.color;
      plan.tagged.push(entry);
      continue;
    }
    plan.created.push({
      id: newId(),
      page: g.page,
      kind: o.kind,
      color: o.color,
      themeIds: [...o.themeIds],
      isTerminology: o.isTerminology || undefined,
      rects: g.rects,
      quote: g.quote,
      weight: o.weight,
      author: o.author,
      createdAt: now
    });
  }
  return plan;
}

/**
 * Black it out, Words: a solid bar over each selected line. No quote is kept (the point is to
 * hide those words) and no theme. A hair larger than the line, so ascenders and descenders are
 * covered too.
 */
export function blackoutMarks(
  groups: SelectionGroup[],
  o: { color: string; author: string; now?: string; newId?: () => string }
): Annotation[] {
  const now = o.now ?? new Date().toISOString();
  const newId = o.newId ?? newAnnotationId;
  const PAD = 0.002;
  return groups.flatMap((g) =>
    g.rects.map<Annotation>((r) => {
      const x = Math.max(0, r.x - PAD);
      const y = Math.max(0, r.y - PAD);
      return {
        id: newId(),
        page: g.page,
        kind: 'rect',
        color: o.color,
        themeIds: [],
        box: { x, y, w: Math.min(1, r.x + r.w + PAD) - x, h: Math.min(1, r.y + r.h + PAD) - y },
        filled: true,
        blackout: true,
        weight: 0,
        author: o.author,
        createdAt: now
      };
    })
  );
}
