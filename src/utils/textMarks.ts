/**
 * The mark model for text documents (TXT, EPUB, DOCX): one shape for every kind of mark, shaped
 * like the PDF workspace's `Annotation` so the same tools can act on both.
 *
 * A PDF mark is anchored by page geometry; a text mark by characters: `{ paragraphIndex, start,
 * end }` into the stored text split on blank lines (see ReaderScreen). One range per paragraph.
 * A mark covering several paragraphs is stored as several marks sharing a `groupId`, and every
 * edit made through this module applies to the whole group.
 *
 * Older documents stored two other shapes in the same list: `kind: 'note'` sticky notes
 * (title/content/quote) and `kind: 'format'` inline formats. `migrateTextEntries` reads both into
 * this model without writing anything; the new shape reaches disk only on the reader's next edit.
 */

import type { AnnotationKind, NoteStyle, StrokeStyle } from '../components/pdf/annotationModel';
import type { Annotation as StoredEntry } from './documentStorage';
import type { ParagraphRange } from './textFormatting';
import { themeIdsOf } from './markThemes';

/** The PDF kinds that make sense on text, plus the two older text-only formats. */
export type TextMarkKind =
  | Extract<AnnotationKind, 'highlight' | 'underline' | 'strikeout' | 'note' | 'question' | 'star' | 'exclamation'>
  | 'bold'
  | 'circle';

export interface TextAnchor {
  paragraphIndex: number;
  /** Character offsets into that paragraph's text, `end` exclusive. */
  start: number;
  end: number;
}

export interface TextMark {
  id: string;
  kind: TextMarkKind;
  anchor: TextAnchor;
  /** Shared by the ranges of one mark that covers several paragraphs. Absent for one range. */
  groupId?: string;
  /** Absent only on formats saved before a colour was required. */
  color?: string;
  /** Themes, main first (see utils/markThemes.ts). */
  themeIds: string[];
  /** A term, as in the PDF model: a `highlight` drawn in the live terminology colour. */
  isTerminology?: boolean;
  /** `underline`, `strikeout`: dash pattern. Absent means solid. */
  strokeStyle?: StrokeStyle;
  /** `note`: paper style. Absent means outline. */
  noteStyle?: NoteStyle;
  /** `circle` only (older formats): border thickness in px. */
  thickness?: number;
  /** `underline`, `strikeout`: line weight, a fraction of page width as on PDF marks (see `annotationModel`). */
  weight?: number;
  /** Reactions: glyph size, a fraction of page width as on PDF text boxes. */
  fontSize?: number;
  /** The words this range covers. */
  quote?: string;
  /** `note`: the reader's heading and words (`text`, as on PDF notes). */
  title?: string;
  text?: string;
  author?: string;
  /** Older notes only: the time label they were saved with, sometimes the literal "Just now". */
  timestamp?: string;
  /** Older notes saved without offsets: attached to the paragraph, not to a passage in it. */
  paragraphOnly?: true;
  /** ISO times. Absent on marks made before times were recorded. */
  createdAt?: string;
  updatedAt?: string;
  /** Where the reader put this excerpt on the excerpt board (px from its top left). Absent: in the tray. */
  board?: { x: number; y: number };
  /** Came in a teacher's class pack (signed with `author`). */
  fromClassPack?: true;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Whether a stored entry is already in the text-mark shape. */
export function isTextMark(entry: unknown): entry is TextMark {
  const e = entry as Partial<TextMark> | null;
  const a = e?.anchor;
  return !!e && isStr(e.id) && isStr(e.kind) && !!a && isNum(a.paragraphIndex) && isNum(a.start) && isNum(a.end);
}

const FORMAT_TYPES: readonly string[] = ['bold', 'highlight', 'underline', 'circle'];

const LEGACY_NOTE_FIELDS: readonly string[] = ['id', 'kind', 'paragraphIndex', 'start', 'end', 'themeId', 'themeIds', 'color', 'title', 'content', 'author', 'timestamp', 'createdAt', 'quote'];

/** An older text note: `kind: 'note'` with a paragraph index. PDF notes also say `kind: 'note'`, but carry `page`. */
function legacyNote(e: Record<string, unknown>): TextMark | null {
  if (e.kind !== 'note' || 'page' in e || !isNum(e.paragraphIndex) || !isStr(e.id)) return null;
  const precise = isNum(e.start) && isNum(e.end);
  // Fields this model does not know ride along as they were; the ones read below are type-checked there.
  const extra = Object.fromEntries(Object.entries(e).filter(([k]) => !LEGACY_NOTE_FIELDS.includes(k)));
  const mark: TextMark = {
    ...extra,
    id: e.id,
    kind: 'note',
    anchor: { paragraphIndex: e.paragraphIndex, start: precise ? (e.start as number) : 0, end: precise ? (e.end as number) : 0 },
    themeIds: themeIdsOf(e)
  };
  if (!precise) mark.paragraphOnly = true;
  if (isStr(e.color)) mark.color = e.color;
  if (isStr(e.title)) mark.title = e.title;
  if (isStr(e.content)) mark.text = e.content;
  if (isStr(e.author)) mark.author = e.author;
  if (isStr(e.timestamp)) mark.timestamp = e.timestamp;
  if (isStr(e.createdAt)) mark.createdAt = e.createdAt;
  if (isStr(e.quote)) mark.quote = e.quote;
  return mark;
}

function legacyFormat(e: Record<string, unknown>): TextMark | null {
  if (e.kind !== 'format' || !isStr(e.id) || !isNum(e.paragraphIndex) || !isNum(e.start) || !isNum(e.end)) return null;
  if (!isStr(e.type) || !FORMAT_TYPES.includes(e.type)) return null;
  const mark: TextMark = {
    id: e.id,
    kind: e.type as TextMarkKind,
    anchor: { paragraphIndex: e.paragraphIndex, start: e.start, end: e.end },
    themeIds: themeIdsOf(e)
  };
  if (isStr(e.color)) mark.color = e.color;
  if (isNum(e.thickness)) mark.thickness = e.thickness;
  return mark;
}

/**
 * Splits a document's stored list into text marks (older shapes converted) and everything else,
 * which is carried through untouched. `migrated` is true when an older entry was converted.
 * Pure: it never writes, so a document is only rewritten in the new shape when the reader edits.
 */
export function migrateTextEntries(raw: StoredEntry[]): { marks: TextMark[]; others: StoredEntry[]; migrated: boolean } {
  const marks: TextMark[] = [];
  const others: StoredEntry[] = [];
  let migrated = false;
  for (const entry of raw) {
    if (isTextMark(entry)) {
      marks.push(entry);
      continue;
    }
    const old = legacyNote(entry) ?? legacyFormat(entry);
    if (old) {
      marks.push(old);
      migrated = true;
    } else others.push(entry);
  }
  return { marks, others, migrated };
}

/**
 * What a new mark is made of; the anchor, ids and times come from the selection. So does the
 * quote, unless one is given (a note whose excerpt was edited before it was first saved): then it
 * goes on the first range and the others cite nothing, as `updateTextMarks` does for an edit.
 */
export type NewTextMark = Pick<TextMark, 'kind' | 'themeIds'> &
  Partial<Pick<TextMark, 'color' | 'isTerminology' | 'strokeStyle' | 'noteStyle' | 'title' | 'text' | 'author' | 'weight' | 'fontSize' | 'paragraphOnly' | 'quote'>>;

/**
 * Fields an edit may change. Anchors, ids, groups and times are not edits. `quote` is the words a
 * note cites; `''` means it cites none (absent would fall back to the anchored passage).
 */
export type TextMarkPatch = Partial<
  Pick<TextMark, 'kind' | 'color' | 'themeIds' | 'isTerminology' | 'strokeStyle' | 'noteStyle' | 'title' | 'text' | 'quote' | 'thickness' | 'weight' | 'fontSize' | 'board'>
>;

/** Ids only have to be unique within one document. */
export function newTextMarkId(): string {
  return `tm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * One mark per range of a selection. Several ranges (a selection across paragraphs) share a
 * `groupId`, and each range carries the shared fields, so any one of them can be drawn, searched
 * or edited on its own while edits made here keep the group in step.
 */
export function createTextMarks(
  ranges: ParagraphRange[],
  props: NewTextMark,
  ctx: { paragraphs: string[]; now: string; newId?: () => string }
): TextMark[] {
  const newId = ctx.newId ?? newTextMarkId;
  const groupId = ranges.length > 1 ? newId() : undefined;
  return ranges.map((r, i) => {
    const mark: TextMark = {
      ...props,
      id: newId(),
      anchor: { paragraphIndex: r.paraIdx, start: r.start, end: r.end },
      quote: props.quote !== undefined ? (i === 0 ? props.quote : '') : (ctx.paragraphs[r.paraIdx] ?? '').slice(r.start, r.end),
      createdAt: ctx.now,
      updatedAt: ctx.now
    };
    if (groupId) mark.groupId = groupId;
    return mark;
  });
}

/** Ids of every mark in the same groups as `ids` (a mark with no group is its own group). */
export function expandToGroups(marks: TextMark[], ids: Iterable<string>): Set<string> {
  const wanted = new Set(ids);
  const groups = new Set(marks.filter((m) => wanted.has(m.id) && m.groupId).map((m) => m.groupId));
  return new Set(marks.filter((m) => wanted.has(m.id) || (m.groupId !== undefined && groups.has(m.groupId))).map((m) => m.id));
}

/**
 * Applies `patch` to the marks named and the rest of their groups, stamping `updatedAt`. A mark
 * the patch would not change is returned as the same object, so the undo history sees no step.
 */
export function updateTextMarks(marks: TextMark[], ids: Iterable<string>, patch: TextMarkPatch, now: string): TextMark[] {
  const hit = expandToGroups(marks, ids);
  // A group's ranges are joined into one quote when shown, so an edited quote goes on the first
  // range only and the others are silenced, or the words would repeat once per paragraph.
  const heads = patch.quote !== undefined ? new Set(groupHeads(marks.filter((m) => hit.has(m.id))).map((m) => m.id)) : null;
  return marks.map((m) => {
    if (!hit.has(m.id)) return m;
    const p: TextMarkPatch = heads && !heads.has(m.id) ? { ...patch, quote: '' } : patch;
    const keys = Object.keys(p) as (keyof TextMarkPatch)[];
    return keys.some((k) => m[k] !== p[k]) ? { ...m, ...p, updatedAt: now } : m;
  });
}

/** Removes the marks named and every other range of their groups. */
export function deleteTextMarks(marks: TextMark[], ids: Iterable<string>): TextMark[] {
  const hit = expandToGroups(marks, ids);
  return marks.filter((m) => !hit.has(m.id));
}

/** Reading order: paragraph, then start, then end. */
export function compareTextAnchors(a: TextAnchor, b: TextAnchor): number {
  return a.paragraphIndex - b.paragraphIndex || a.start - b.start || a.end - b.end;
}

export function sortTextMarks(marks: TextMark[]): TextMark[] {
  return [...marks].sort((a, b) => compareTextAnchors(a.anchor, b.anchor));
}

/** The first range of each group in reading order, plus every ungrouped mark; input order kept. */
export function groupHeads(marks: TextMark[]): TextMark[] {
  const head = new Map<string, TextMark>();
  for (const m of marks) {
    if (!m.groupId) continue;
    const seen = head.get(m.groupId);
    if (!seen || compareTextAnchors(m.anchor, seen.anchor) < 0) head.set(m.groupId, m);
  }
  return marks.filter((m) => !m.groupId || head.get(m.groupId) === m);
}
