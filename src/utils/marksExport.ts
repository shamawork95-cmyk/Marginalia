/**
 * Exports of one document's marks and notes, for every format (PDF marks by page, text marks by
 * paragraph or poem line):
 *
 *   - `marksToMarkdown`: every mark with its quote, place, theme, colour, note and times.
 *   - `marksToJson` / `parseMarksJson`: the stored marks verbatim (so re-import is exact, links
 *     and unknown fields included) plus a readable copy; `mergeImportedMarks` adds them back.
 *   - `commonplaceMarkdown` / `commonplaceText`: the commonplace book. Marks grouped by theme,
 *     each cited essay-ready (`"quote" (Title, p. N)`) with the reader's note under it.
 *
 * Pure: the caller downloads the string (`downloadTextFile`). No .docx: no installed dependency
 * writes one, and none was added.
 */

import type { Annotation as StoredEntry } from './documentStorage';
import { groupHeads, migrateTextEntries, sortTextMarks, type TextMark } from './textMarks';
import { formatQuoteRef, locationLabel, markLocation, type MarkLocation } from './quoteRef';
import { resolveTheme, UNTITLED_THEME, type Theme } from './themes';
import { pruneLinks } from './markLinks';
import { themeIdsOf } from './markThemes';
import { plural } from './plural';
import type { ParagraphLayout } from './pastedText';

export interface ExportDocument {
  id?: string;
  title: string;
  author?: string;
  format?: string;
  /** Text documents: how the stored text was split, and the paragraphs (for old marks with no quote). */
  layout?: ParagraphLayout;
  paragraphs?: string[];
}

/** One mark as the exports see it. A multi-paragraph text mark is one entry. */
export interface ExportMark {
  id: string;
  kind: string;
  /** "Highlight", "Area highlight", "Term", a note's own title… */
  label: string;
  location: MarkLocation | null;
  /** The marked words ('' for drawings and area marks). Paragraph breaks are `\n`. */
  quote: string;
  /** The reader's own words on the mark. */
  note: string;
  title?: string;
  /** The main theme (the mark's colour), kept for files read by older versions. */
  themeId: string | null;
  /** Every theme the mark is filed under, main first. */
  themeIds: string[];
  /** Main theme's name; "Untitled" when that theme was deleted; null when untagged. */
  theme: string | null;
  /** Every theme's name, in the order of `themeIds`. */
  themes: string[];
  color: string;
  isTerminology?: true;
  area?: true;
  links?: string[];
  createdAt?: string;
  updatedAt?: string;
}

const KIND_LABELS: Record<string, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikethrough',
  note: 'Note',
  question: 'Reaction (?)',
  star: 'Reaction (*)',
  exclamation: 'Reaction (!)',
  bold: 'Bold',
  circle: 'Circled',
  ink: 'Drawing',
  rect: 'Box',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  line: 'Line',
  bracket: 'Bracket',
  text: 'Text box'
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function labelOf(kind: string, e: { isTerminology?: unknown; area?: unknown; title?: unknown }): string {
  if (e.area === true) return 'Area highlight';
  if (e.isTerminology === true) return 'Term';
  if (kind === 'note' && str(e.title)) return str(e.title);
  return KIND_LABELS[kind] ?? 'Mark';
}

/** Top edge of a PDF mark, for top-to-bottom order within a page. */
function topOf(e: StoredEntry): number {
  const rects = e.rects as { y?: unknown }[] | undefined;
  const candidates = [rects?.[0]?.y, (e.box as { y?: unknown } | undefined)?.y, (e.from as { y?: unknown } | undefined)?.y, (e.points as { y?: unknown }[] | undefined)?.[0]?.y];
  return candidates.find(isNum) ?? 0;
}

function base(e: StoredEntry, themes: Theme[]): Pick<ExportMark, 'id' | 'themeId' | 'themeIds' | 'theme' | 'themes' | 'color' | 'isTerminology' | 'area' | 'links' | 'createdAt' | 'updatedAt'> {
  const themeIds = themeIdsOf(e);
  const names = themeIds.map((id) => resolveTheme(themes, id)!.name);
  const out: ReturnType<typeof base> = { id: e.id, themeId: themeIds[0] ?? null, themeIds, theme: names[0] ?? null, themes: names, color: str(e.color) };
  if (e.isTerminology === true) out.isTerminology = true;
  if (e.area === true) out.area = true;
  if (Array.isArray(e.links) && e.links.length) out.links = e.links.filter((x): x is string => typeof x === 'string');
  if (str(e.createdAt)) out.createdAt = str(e.createdAt);
  if (str(e.updatedAt)) out.updatedAt = str(e.updatedAt);
  return out;
}

function textEntries(marks: TextMark[], doc: ExportDocument, themes: Theme[]): ExportMark[] {
  const paragraphs = doc.paragraphs ?? [];
  const words = (m: TextMark) => m.quote ?? (paragraphs[m.anchor.paragraphIndex] ?? '').slice(m.anchor.start, m.anchor.end);
  const ordered = sortTextMarks(marks);
  return groupHeads(ordered).map((head) => {
    const ranges = head.groupId ? ordered.filter((m) => m.groupId === head.groupId) : [head];
    const ctx = { paragraphs, layout: doc.layout };
    let location = markLocation(head as unknown as StoredEntry, ctx);
    const last = markLocation(ranges[ranges.length - 1] as unknown as StoredEntry, ctx);
    if (location?.kind === 'line' && last?.kind === 'line') {
      const endLine = last.endLine ?? last.line;
      location = endLine > location.line ? { kind: 'line', line: location.line, endLine } : { kind: 'line', line: location.line };
    }
    const entry: ExportMark = {
      ...base(head as unknown as StoredEntry, themes),
      kind: head.kind,
      label: labelOf(head.kind, head),
      location,
      quote: ranges.map(words).filter(Boolean).join('\n'),
      note: head.text ?? ''
    };
    if (head.kind === 'note' && head.title) entry.title = head.title;
    return entry;
  });
}

function pdfEntries(entries: StoredEntry[], themes: Theme[]): ExportMark[] {
  return [...entries]
    .sort((a, b) => (isNum(a.page) ? a.page : 0) - (isNum(b.page) ? b.page : 0) || topOf(a) - topOf(b))
    .map((e) => {
      const kind = str(e.kind) || 'mark';
      const entry: ExportMark = {
        ...base(e, themes),
        kind,
        label: labelOf(kind, { isTerminology: e.isTerminology, area: e.area, title: e.title }),
        location: markLocation(e),
        quote: str(e.quote),
        note: str(e.text)
      };
      if (kind === 'note' && str(e.title)) entry.title = str(e.title);
      return entry;
    });
}

/** A document's stored marks as export entries: text marks in reading order, then PDF marks by page. */
export function collectExportMarks(annotations: StoredEntry[], doc: ExportDocument, themes: Theme[]): ExportMark[] {
  const { marks, others } = migrateTextEntries(annotations);
  return [...textEntries(marks, doc, themes), ...pdfEntries(others, themes)];
}

const day = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? iso.slice(0, 10) : '');

const blockquote = (text: string) => text.split('\n').map((line) => `> ${line}`).join('\n');

/** Markdown of every mark and note: quote, place, theme, colour, note, times, links. */
export function marksToMarkdown(
  annotations: StoredEntry[],
  doc: ExportDocument,
  themes: Theme[],
  opts: { exportedAt?: string } = {}
): string {
  const marks = collectExportMarks(annotations, doc, themes);
  const number = new Map(marks.map((m, i) => [m.id, i + 1]));
  let md = `# ${doc.title}: marks and notes\n\n`;
  if (doc.author) md += `*${doc.author}*\n\n`;
  md += `Exported ${day(opts.exportedAt ?? new Date().toISOString())} · ${plural(marks.length, 'mark')}\n\n---\n\n`;
  marks.forEach((m, i) => {
    md += `### ${i + 1}. ${m.label}${m.location ? ` · ${locationLabel(m.location)}` : ''}\n\n`;
    if (m.quote) md += `${blockquote(m.quote)}\n\n`;
    if (m.note) md += `${m.note}\n\n`;
    const facts = [m.themes.length > 1 ? `Themes: ${m.themes.join(', ')}` : `Theme: ${m.theme ?? 'None'}`];
    if (m.color) facts.push(`Colour: ${m.color}`);
    if (day(m.createdAt)) facts.push(`Created: ${day(m.createdAt)}`);
    if (day(m.updatedAt)) facts.push(`Updated: ${day(m.updatedAt)}`);
    const linked = (m.links ?? []).map((id) => number.get(id)).filter(isNum);
    if (linked.length) facts.push(`Linked to: ${linked.join(', ')}`);
    md += `${facts.map((f) => `- ${f}`).join('\n')}\n\n`;
  });
  return md;
}

const JSON_FORMAT = 'marginalia-marks';
const JSON_VERSION = 1;

/**
 * JSON export: `annotations` holds the stored marks verbatim (what re-import reads back), `marks`
 * a readable copy, `themes` the themes the marks use.
 */
export function marksToJson(
  annotations: StoredEntry[],
  doc: ExportDocument,
  themes: Theme[],
  opts: { exportedAt?: string } = {}
): string {
  const marks = collectExportMarks(annotations, doc, themes);
  const used = new Set(marks.flatMap((m) => m.themeIds));
  const document: Record<string, string> = { title: doc.title };
  if (doc.id) document.id = doc.id;
  if (doc.author) document.author = doc.author;
  if (doc.format) document.format = doc.format;
  return JSON.stringify(
    {
      format: JSON_FORMAT,
      version: JSON_VERSION,
      exportedAt: opts.exportedAt ?? new Date().toISOString(),
      document,
      themes: themes.filter((t) => used.has(t.id)),
      marks,
      annotations
    },
    null,
    2
  );
}

export type ParsedMarks =
  | { ok: true; document: Record<string, string>; themes: Theme[]; annotations: StoredEntry[] }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every stored kind: the PDF kinds, the text-only bold/circle, and the older text `format` entries. */
const STORED_KINDS = new Set([
  'highlight', 'underline', 'strikeout', 'question', 'star', 'exclamation', 'ink', 'note',
  'rect', 'ellipse', 'arrow', 'line', 'bracket', 'text', 'bold', 'circle', 'format'
]);
/** The pattern `themes.ts` checks theme colours with. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const MAX_IMPORTED_MARKS = 20_000;
/** Far above any real export of 20,000 marks; refused before parsing. */
const MAX_IMPORT_CHARS = 50_000_000;
const TOO_BIG = `This export is too large to import (the limit is ${MAX_IMPORTED_MARKS.toLocaleString('en-US')} marks).`;

const isRect = (r: unknown) => isObj(r) && isNum(r.x) && isNum(r.y) && isNum(r.w) && isNum(r.h);

/** A stored mark we can place: a known kind, a page (PDF) or text anchor (new or older shape), sane rects. */
export function isImportableEntry(e: unknown): e is StoredEntry {
  if (!isObj(e) || typeof e.id !== 'string' || typeof e.kind !== 'string' || !STORED_KINDS.has(e.kind)) return false;
  const a = e.anchor;
  const placed = isNum(e.page) || (isObj(a) && isNum(a.paragraphIndex) && isNum(a.start) && isNum(a.end)) || isNum(e.paragraphIndex);
  if (!placed) return false;
  return e.rects === undefined || (Array.isArray(e.rects) && e.rects.every(isRect));
}

/** Reads a JSON export back. Marks that cannot be placed, and malformed themes, are dropped. */
export function parseMarksJson(text: string): ParsedMarks {
  if (text.length > MAX_IMPORT_CHARS) return { ok: false, error: TOO_BIG };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a Marginalia marks export.' };
  }
  if (!isObj(body) || body.format !== JSON_FORMAT) return { ok: false, error: 'This file is not a Marginalia marks export.' };
  if (body.version !== JSON_VERSION) return { ok: false, error: 'This export was made by a newer version of Marginalia.' };
  if (!Array.isArray(body.annotations)) return { ok: false, error: 'This export holds no marks.' };
  if (body.annotations.length > MAX_IMPORTED_MARKS) return { ok: false, error: TOO_BIG };
  const annotations = body.annotations.filter(isImportableEntry);
  const themes = (Array.isArray(body.themes) ? body.themes : []).filter(
    (t): t is Theme =>
      isObj(t) && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.color === 'string' && HEX_COLOR.test(t.color)
  );
  const document = isObj(body.document)
    ? Object.fromEntries(Object.entries(body.document).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    : {};
  return { ok: true, document, themes, annotations };
}

/** The current marks plus every imported mark whose id is not already there; dangling links dropped. */
export function mergeImportedMarks(current: StoredEntry[], imported: StoredEntry[]): { annotations: StoredEntry[]; added: number } {
  const have = new Set(current.map((m) => m.id));
  const fresh = imported.filter((m) => !have.has(m.id));
  const merged = pruneLinks([...current, ...fresh] as (StoredEntry & { links?: string[] })[]);
  return { annotations: merged, added: fresh.length };
}

/** Imported themes the reader does not have (by id), to add to their list. */
export function themesToAdd(local: Theme[], imported: Theme[]): Theme[] {
  const have = new Set(local.map((t) => t.id));
  return imported.filter((t) => !have.has(t.id));
}

// ── Commonplace book ──────────────────────────────────────────────────────────

const NO_THEME = 'No theme';

/** Sections in the reader's theme order, then marks under deleted themes ("Untitled"), then unthemed. */
function commonplaceSections(annotations: StoredEntry[], doc: ExportDocument, themes: Theme[]): { name: string; marks: ExportMark[] }[] {
  const marks = collectExportMarks(annotations, doc, themes).filter((m) => m.quote || m.note || m.area);
  const known = new Set(themes.map((t) => t.id));
  // A mark under several themes appears in each of their sections.
  const sections = themes.map((t) => ({ name: t.name, marks: marks.filter((m) => m.themeIds.includes(t.id)) }));
  sections.push({ name: UNTITLED_THEME.name, marks: marks.filter((m) => m.themeIds.length > 0 && !m.themeIds.some((id) => known.has(id))) });
  sections.push({ name: NO_THEME, marks: marks.filter((m) => m.themeIds.length === 0) });
  return sections.filter((s) => s.marks.length);
}

/** `"quote" (Title, p. N)`, or `[Area highlight] (Title, p. N)` for a mark without words. */
function citation(m: ExportMark, title: string): string {
  if (m.quote) return formatQuoteRef(m.quote, title, m.location);
  return `[${m.label}] (${title}${m.location ? `, ${locationLabel(m.location)}` : ''})`;
}

export function commonplaceMarkdown(annotations: StoredEntry[], doc: ExportDocument, themes: Theme[]): string {
  let md = `# Commonplace book: ${doc.title}\n\n`;
  if (doc.author) md += `*${doc.author}*\n\n`;
  for (const section of commonplaceSections(annotations, doc, themes)) {
    md += `## ${section.name}\n\n`;
    for (const m of section.marks) {
      md += `> ${citation(m, doc.title)}\n\n`;
      if (m.note) md += `${m.note}\n\n`;
    }
  }
  return md;
}

export function commonplaceText(annotations: StoredEntry[], doc: ExportDocument, themes: Theme[]): string {
  const heading = `COMMONPLACE BOOK: ${doc.title.toUpperCase()}`;
  let txt = `${heading}\n${'='.repeat(heading.length)}\n`;
  if (doc.author) txt += `${doc.author}\n`;
  txt += '\n';
  for (const section of commonplaceSections(annotations, doc, themes)) {
    const name = section.name.toUpperCase();
    txt += `${name}\n${'-'.repeat(name.length)}\n\n`;
    for (const m of section.marks) {
      txt += `${citation(m, doc.title)}\n`;
      if (m.note) txt += `    ${m.note.replace(/\n/g, '\n    ')}\n`;
      txt += '\n';
    }
  }
  return txt;
}
