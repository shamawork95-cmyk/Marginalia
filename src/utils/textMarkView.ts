/**
 * What the text reader draws and hands to the shared annotation tools, from its marks. Pure.
 *
 * - `segmentParagraph`: a paragraph cut at every mark edge, each piece listing the marks over it,
 *   so the reader renders one span per piece.
 * - `uncoveredRanges`: marking adds and never toggles (the PDF workspace's rule), so ranges that
 *   already carry the same mark are skipped.
 * - `textMarkViews`: each mark (one per group) in the PDF `Annotation` shape the notes panel, the
 *   properties strip and the instance navigator read. `page` is the paragraph number, and the
 *   character offset stands in for the height on the page, so the panel's reading order holds.
 */

import type { Annotation } from '../components/pdf/annotationModel';
import type { ParagraphRange } from './textFormatting';
import { groupHeads, sortTextMarks, type TextMark, type TextMarkKind } from './textMarks';
import { unionThemeIds } from './markThemes';

/** Older text notes stored a palette name rather than a colour. */
const NAMED: Record<string, string> = { yellow: '#d4a017', purple: '#a855f7', teal: '#14b8a6', rose: '#f43f5e' };

/** A mark's colour as CSS hex: palette names mapped, and `fallback` for marks saved without one. */
export function markColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return NAMED[color] ?? color;
}

export interface Segment {
  start: number;
  end: number;
  /** Marks over this piece, in the order given (later ones are drawn on top). */
  ids: string[];
}

export function segmentParagraph(length: number, marks: TextMark[]): Segment[] {
  if (length <= 0) return [];
  const clamp = (n: number) => Math.max(0, Math.min(length, n));
  const live = marks.filter((m) => clamp(m.anchor.end) > clamp(m.anchor.start));
  const cuts = [...new Set([0, length, ...live.flatMap((m) => [clamp(m.anchor.start), clamp(m.anchor.end)])])].sort(
    (a, b) => a - b
  );
  const segments: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [start, end] = [cuts[i], cuts[i + 1]];
    segments.push({ start, end, ids: live.filter((m) => m.anchor.start <= start && m.anchor.end >= end).map((m) => m.id) });
  }
  return segments;
}

export function uncoveredRanges(
  marks: TextMark[],
  ranges: ParagraphRange[],
  kind: TextMarkKind,
  isTerminology: boolean,
  /** Covered only by marks that carry every one of these themes. Empty: any mark of this kind. */
  themeIds: readonly string[] = []
): ParagraphRange[] {
  return ranges.filter((r) => {
    const same = sameKindIn(marks, r.paraIdx, kind, isTerminology)
      .filter((m) => themeIds.every((t) => m.themeIds?.includes(t)))
      .sort((a, b) => a.anchor.start - b.anchor.start);
    let cursor = r.start;
    for (const m of same) {
      if (m.anchor.start > cursor) break;
      cursor = Math.max(cursor, m.anchor.end);
    }
    return cursor < r.end;
  });
}

const sameKindIn = (marks: TextMark[], paraIdx: number, kind: TextMarkKind, isTerminology: boolean) =>
  marks.filter((m) => m.anchor.paragraphIndex === paraIdx && m.kind === kind && Boolean(m.isTerminology) === isTerminology);

/**
 * What marking a selection in the reader does, range by range. Already marked this way under every
 * chosen theme: nothing. Inside one mark of this kind: that mark gets the chosen themes it lacks
 * (one passage, several themes). Otherwise the range is marked anew.
 */
export function planTextRanges(
  marks: TextMark[],
  ranges: ParagraphRange[],
  kind: TextMarkKind,
  isTerminology: boolean,
  themeIds: readonly string[],
  color: string
): { create: ParagraphRange[]; tag: { id: string; themeIds: string[]; color?: string }[] } {
  const create: ParagraphRange[] = [];
  const tag: { id: string; themeIds: string[]; color?: string }[] = [];
  for (const r of uncoveredRanges(marks, ranges, kind, isTerminology, themeIds)) {
    const host = sameKindIn(marks, r.paraIdx, kind, isTerminology).find((m) => m.anchor.start <= r.start && m.anchor.end >= r.end);
    if (!host) {
      create.push(r);
      continue;
    }
    if (tag.some((t) => t.id === host.id)) continue;
    const before = host.themeIds ?? [];
    const entry: { id: string; themeIds: string[]; color?: string } = { id: host.id, themeIds: unionThemeIds(before, themeIds) };
    if (before.length === 0 && !isTerminology) entry.color = color;
    tag.push(entry);
  }
  return { create, tag };
}

export function textMarkViews(marks: TextMark[], paragraphs: string[], terminologyColor: string): Annotation[] {
  const ordered = sortTextMarks(marks);
  const words = (m: TextMark) => m.quote ?? (paragraphs[m.anchor.paragraphIndex] ?? '').slice(m.anchor.start, m.anchor.end);
  return groupHeads(marks).map((head) => {
    const ranges = head.groupId ? ordered.filter((m) => m.groupId === head.groupId) : [head];
    const quote = ranges.map(words).filter(Boolean).join(' ');
    const at = head.anchor.start / ((paragraphs[head.anchor.paragraphIndex]?.length ?? 0) + 1);
    const view: Annotation = {
      id: head.id,
      page: head.anchor.paragraphIndex + 1,
      // `bold` and `circle` exist only on older text marks; the tools treat them as plain marks.
      kind: head.kind as Annotation['kind'],
      color: head.isTerminology ? terminologyColor : markColor(head.color, '#8b5cf6'),
      themeIds: head.themeIds ?? [],
      rects: [{ x: at, y: at, w: 0, h: 0 }],
      createdAt: head.createdAt ?? ''
    };
    if (head.isTerminology) view.isTerminology = true;
    if (quote) view.quote = quote;
    // The panel has no title line, so a note's title leads its text: shown first and searched.
    const text = [head.kind === 'note' ? head.title?.trim() : '', head.text].filter(Boolean).join('\n');
    if (text) view.text = text;
    if (head.author) view.author = head.author;
    if (head.weight !== undefined) view.weight = head.weight;
    if (head.strokeStyle) view.strokeStyle = head.strokeStyle;
    if (head.noteStyle) view.noteStyle = head.noteStyle;
    if (head.fontSize !== undefined) view.fontSize = head.fontSize;
    return view;
  });
}

/**
 * Per-paragraph lists that keep the previous render's array wherever nothing in it changed, so a
 * memoised paragraph sees the same prop and skips rendering. Marks are immutable (an edit makes a
 * new object), so identity per element is the test unless `same` says otherwise.
 */
export function reuseUnchanged<T>(
  prev: Map<number, T[]>,
  next: Map<number, T[]>,
  same: (a: T, b: T) => boolean = Object.is
): Map<number, T[]> {
  for (const [key, list] of next) {
    const old = prev.get(key);
    if (old && old.length === list.length && old.every((item, i) => same(item, list[i]))) next.set(key, old);
  }
  return next;
}
