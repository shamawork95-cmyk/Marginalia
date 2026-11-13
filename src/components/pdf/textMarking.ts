/**
 * Turning a PDF text selection into marks: the pure part of `useTextMarking`, so it is tested.
 *
 * A selection arrives as one group per page (its line rectangles and its own words). Marking adds
 * and never toggles: a page already carrying the same kind of mark, under the same theme, over
 * those words is skipped, while the same words under another theme get a second mark.
 */

import { coveredFraction, newAnnotationId, type Annotation, type AnnotationKind, type FractionRect } from './annotationModel';

export interface SelectionGroup {
  page: number;
  rects: FractionRect[];
  quote: string;
}

/**
 * Whether a page's part of a selection already carries a mark of this kind, flag and theme.
 * Every line has to be substantially covered (80%): a selection's rectangles run a hair wider than
 * the glyphs they contain, and a re-selection rarely reproduces the first one to the character.
 */
export function isAlreadyMarked(
  annotations: Annotation[],
  group: { page: number; rects: FractionRect[] },
  kind: AnnotationKind,
  isTerminology = false,
  themeId: string | null = null
): boolean {
  // Under another theme the same words can be marked again (one passage, several themes).
  const existing = annotations
    .filter(
      (a) =>
        a.kind === kind &&
        Boolean(a.isTerminology) === isTerminology &&
        (a.themeId ?? null) === themeId &&
        a.page === group.page &&
        a.rects?.length
    )
    .flatMap((a) => a.rects!);
  if (existing.length === 0) return false;
  return group.rects.every((rect) => coveredFraction(rect, existing) >= 0.8);
}

/** The new marks a selection makes: one per page not already marked this way. */
export function newTextMarks(
  annotations: Annotation[],
  groups: SelectionGroup[],
  o: {
    kind: AnnotationKind;
    isTerminology: boolean;
    themeId: string | null;
    color: string;
    weight?: number;
    author: string;
    now?: string;
    newId?: () => string;
  }
): Annotation[] {
  const now = o.now ?? new Date().toISOString();
  const newId = o.newId ?? newAnnotationId;
  return groups
    .filter((g) => !isAlreadyMarked(annotations, g, o.kind, o.isTerminology, o.themeId))
    .map<Annotation>((g) => ({
      id: newId(),
      page: g.page,
      kind: o.kind,
      color: o.color,
      themeId: o.themeId,
      isTerminology: o.isTerminology || undefined,
      rects: g.rects,
      quote: g.quote,
      weight: o.weight,
      author: o.author,
      createdAt: now
    }));
}
