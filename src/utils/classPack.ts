/**
 * Offline classroom sharing: a class pack is one file a teacher saves and hands to students by
 * USB stick, shared drive, AirDrop or email. It holds the document itself (text, layout, pasted
 * formatting, and the original PDF/EPUB/DOCX when there is one) with the teacher's marks and the
 * themes they use, so a student opens it with no account, no server and no internet.
 *
 * Importing makes a new document in the student's library, the teacher's marks on it signed with
 * the teacher's name; the student's own marks go on top and never change the teacher's file.
 *
 * Pure, so it is tested; the client builds the file (`buildClassPack`), the server reads it
 * (`parseClassPack`, in `services/libraryRoutes`).
 */

import type { Annotation as StoredEntry } from './documentStorage';
import { isImportableEntry, MAX_IMPORTED_MARKS } from './marksExport';
import type { Theme } from './themes';
import { themeIdsOf, writeAllThemes } from './markThemes';
import type { TextStyle } from './pastedText';

export const CLASS_PACK_FORMAT = 'marginalia-class-pack';
export const CLASS_PACK_VERSION = 1;
export const CLASS_PACK_EXTENSION = '.marginalia-class';
/** The original file, base64; generous for a set text, small enough to read into memory. */
export const MAX_PACK_ORIGINAL_BYTES = 60 * 1024 * 1024;

export interface ClassPackDocument {
  title: string;
  format: string;
  text: string;
  layout?: 'verbatim';
  textStyles?: TextStyle[];
  filename?: string;
  /** The original file's bytes, base64. Absent for pasted text and documents with none. */
  original?: string;
}

export interface ClassPack {
  format: typeof CLASS_PACK_FORMAT;
  version: typeof CLASS_PACK_VERSION;
  createdAt: string;
  /** Who made it: the teacher's name from Settings. */
  teacher: string;
  /** A line for the class ("Read stanzas 1–3 before Thursday"). */
  message?: string;
  document: ClassPackDocument;
  themes: Theme[];
  annotations: StoredEntry[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The pack as a string. Marks keep their ids so a second import of the same pack adds nothing. */
export function buildClassPack(p: {
  teacher: string;
  message?: string;
  document: ClassPackDocument;
  themes: Theme[];
  annotations: StoredEntry[];
  createdAt?: string;
}): string {
  const used = new Set(p.annotations.flatMap((a) => themeIdsOf(a)));
  const pack: ClassPack = {
    format: CLASS_PACK_FORMAT,
    version: CLASS_PACK_VERSION,
    createdAt: p.createdAt ?? new Date().toISOString(),
    teacher: p.teacher.trim() || 'Teacher',
    ...(p.message?.trim() ? { message: p.message.trim() } : {}),
    document: p.document,
    themes: p.themes.filter((t) => used.has(t.id)),
    // With the older single `themeId` too, so a student on an older version still sees the main theme.
    annotations: writeAllThemes(p.annotations)
  };
  return JSON.stringify(pack);
}

export type ParsedClassPack = { ok: true; pack: ClassPack } | { ok: false; error: string };

const NOT_A_PACK = 'This file is not a Marginalia class pack.';

/** Reads a pack back, checking every field; marks that cannot be placed are dropped. */
export function parseClassPack(body: unknown): ParsedClassPack {
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { ok: false, error: NOT_A_PACK };
    }
  }
  if (!isObj(body) || body.format !== CLASS_PACK_FORMAT) return { ok: false, error: NOT_A_PACK };
  if (body.version !== CLASS_PACK_VERSION) return { ok: false, error: 'This class pack was made by a newer version of Marginalia.' };
  const d = body.document;
  if (!isObj(d) || typeof d.text !== 'string' || !d.text.trim()) return { ok: false, error: 'This class pack has no document in it.' };
  const annotations = Array.isArray(body.annotations) ? body.annotations : [];
  if (annotations.length > MAX_IMPORTED_MARKS) return { ok: false, error: 'This class pack has too many marks to import.' };
  let original: string | undefined;
  if (typeof d.original === 'string' && d.original) {
    if (d.original.length > (MAX_PACK_ORIGINAL_BYTES * 4) / 3 + 4 || !BASE64.test(d.original)) {
      return { ok: false, error: 'The document inside this class pack is damaged or too large.' };
    }
    original = d.original;
  }
  const textStyles = Array.isArray(d.textStyles)
    ? d.textStyles.filter(
        (s): s is TextStyle =>
          isObj(s) &&
          isObj(s.anchor) &&
          [s.anchor.paragraphIndex, s.anchor.start, s.anchor.end].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
          (s.style === 'bold' || s.style === 'italic' || s.style === 'underline')
      )
    : [];
  const teacher = str(body.teacher, 120).trim() || 'Teacher';
  const pack: ClassPack = {
    format: CLASS_PACK_FORMAT,
    version: CLASS_PACK_VERSION,
    createdAt: str(body.createdAt, 40),
    teacher,
    ...(str(body.message, 2000).trim() ? { message: str(body.message, 2000).trim() } : {}),
    document: {
      title: str(d.title, 300).trim() || 'Class reading',
      format: str(d.format, 16) || 'TXT',
      text: d.text,
      ...(d.layout === 'verbatim' ? { layout: 'verbatim' as const } : {}),
      ...(textStyles.length ? { textStyles } : {}),
      ...(str(d.filename, 260) ? { filename: str(d.filename, 260) } : {}),
      ...(original ? { original } : {})
    },
    themes: (Array.isArray(body.themes) ? body.themes : []).filter(
      (t): t is Theme => isObj(t) && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.color === 'string' && HEX_COLOR.test(t.color)
    ),
    // Signed with the teacher's name, so the student can tell the two sets of marks apart.
    annotations: annotations.filter(isImportableEntry).map((a) => ({ ...a, author: teacher, fromClassPack: true }))
  };
  return { ok: true, pack };
}

/** "Odes – class pack.marginalia-class" */
export function classPackFilename(title: string): string {
  const stem = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document';
  return `${stem} – class pack${CLASS_PACK_EXTENSION}`;
}
