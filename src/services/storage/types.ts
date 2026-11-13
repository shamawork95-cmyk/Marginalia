import type { TextStyle } from '../../utils/pastedText';
import { themeIdsOf } from '../../utils/markThemes';

/**
 * The storage contract every document backend implements. One exists today: the local
 * filesystem. The interface is kept so the store can be swapped without touching its callers.
 *
 * A backend stores three things per document — the extracted text plus metadata, the original
 * uploaded file byte-for-byte, and the reader's annotations — under this logical layout:
 *
 *   documents/{id}.json   metadata + extracted text + annotations
 *   originals/{id}{ext}   the raw uploaded file
 */

/** Everything about a stored document except its (potentially huge) text and original bytes. */
export interface DocumentMeta {
  id: string;
  title: string;
  format: string;
  /** Original upload filename, kept so a re-download hands back the file the user recognizes. */
  filename: string;
  wordCount: number;
  /** Byte size of the stored original, or 0 when the document was pasted rather than uploaded. */
  originalBytes: number;
  createdAt: string;
  /** Last time the title or annotations changed, so the library can sort by recent activity. */
  updatedAt: string;
  /**
   * When the sweeper becomes eligible to delete this document, or null when retention is
   * disabled — the default. See RETENTION_DAYS.
   */
  expiresAt: string | null;
  /** How many annotations are stored, so the library can show a count without loading them. */
  annotationCount: number;
  /**
   * The distinct set of theme ids tagged anywhere in this document's annotations, so a
   * cross-document "which books touch theme X" view doesn't have to load every document's full
   * annotation list just to find out. Recomputed from `annotations` on every write; see
   * `computeThemeIds`.
   */
  themeIds: string[];
  /**
   * How many of this document's annotations are marked terminology (`isTerminology: true`), so
   * the Home screen's Terminologies section can list which books have any without loading every
   * document's full annotation list. Recomputed from `annotations` on every write, the same way
   * `themeIds` is; see `countTerminology`.
   */
  terminologyCount: number;
  /**
   * How many marks this document carries under each theme id, so the library can say "4 marks
   * under Key Concepts" rather than only "this book touches Key Concepts". `themeIds` is kept
   * alongside it because a great deal of code only asks the yes/no question.
   */
  themeCounts: Record<string, number>;
  /** The library's "N% completed" (0–100, rounded), or null when the reader has never reported a position. */
  progressPercent: number | null;
  /**
   * `'verbatim'` for pasted custom text that keeps its line breaks and indentation: the reader
   * splits it with `splitParagraphs(text, 'verbatim')`. Absent on every other document.
   */
  layout?: 'verbatim';
}

/**
 * One annotation over the original PDF, in InkLayer Annotation Core v0.1 format.
 *
 * The client library (`inklayer-react`) owns this schema; the server stores and returns these
 * objects verbatim and never interprets their geometry, so the type stays deliberately open
 * rather than duplicating a third-party model that this side has no use for. Only `id` is
 * required, because that is the only field the store itself relies on.
 *
 * Coordinates inside are in PDF user space (origin bottom-left, 1pt = 1/72"), which is what
 * makes an annotation land on the same words no matter what zoom or window size it is later
 * viewed at. See `src/components/pdf/annotationTypes.ts` for the client-side mirror.
 */
export interface StoredAnnotation {
  id: string;
  [key: string]: unknown;
}

/**
 * Where the reader left off in the PDF workspace — zoom, page and single/spread view. Stored
 * alongside the document itself (not in the browser's localStorage) for the same reason
 * `UserSettings` moved server-side: the desktop build's embedded server binds to a fresh random
 * port every launch, so a different port is a different origin to the browser, and localStorage
 * would silently reset on every restart and every auto-update.
 */
export interface ReadingState {
  scale: number;
  page: number;
  /** 'grid4' and 'grid6' since 2.8.0: four or six pages in view, zoomed out. */
  viewMode: 'single' | 'spread' | 'grid4' | 'grid6';
}

export interface StoredDocument extends DocumentMeta {
  text: string;
  annotations: StoredAnnotation[];
  /** Null until the reader has opened this document in the PDF workspace at least once. */
  readingState: ReadingState | null;
  /** Null until the reader has reported a position. See `nextReadingProgress`. */
  readingProgress: ReadingProgress | null;
  /** Bold/italic/underline carried over from pasted HTML. Absent when there was none. */
  textStyles?: TextStyle[];
  /**
   * A thematic analysis saved before 2.5.0 removed the feature. Kept in the record exactly as
   * stored (the reader's data), never read or sent to the client.
   */
  analysis?: unknown;
  /**
   * The annotation set as it was immediately before a write that made it smaller.
   *
   * A shrinking write is usually the reader deleting a mark, which is fine. It is also what a bug
   * looks like when some stale copy of the document overwrites a newer one — and that is
   * unrecoverable, because the store keeps no history and a book's marks are hours of work. One
   * slot costs almost nothing and turns "your annotations are gone" into "restore them".
   */
  annotationsBackup: { annotations: StoredAnnotation[]; savedAt: string; wasCount: number } | null;
  /**
   * Set only between a page edit committing its renumbered marks and swapping the edited PDF
   * (`originals/{id}.next`) into place. Seeing it after a crash means "finish the swap".
   */
  pendingOriginal?: true;
}

/** What a page edit receives (read inside the document's lock) and must return. */
export interface PdfPageEditInput {
  pdf: Buffer;
  filename: string;
  annotations: StoredAnnotation[];
}
export interface PdfPageEditOutput<T> {
  pdf: Uint8Array;
  annotations: StoredAnnotation[];
  result: T;
}

/**
 * Every theme any of a document's own annotations is filed under, sorted for a stable
 * diff/compare. Each annotation is opaque to the store ({id: string; [key: string]: unknown}), so
 * its themes are read defensively (`themeIdsOf`: `themeIds`, or an older single `themeId`).
 */
export function computeThemeIds(annotations: StoredAnnotation[]): string[] {
  const ids = new Set<string>();
  for (const a of annotations) {
    for (const t of themeIdsOf(a)) ids.add(t);
  }
  return Array.from(ids).sort();
}

/**
 * One entry per mark: a text-document mark covering several paragraphs is stored as one entry
 * per paragraph sharing a `groupId`, and counts once. Its ranges share theme and term flags.
 */
function oneEntryPerMark(annotations: StoredAnnotation[]): StoredAnnotation[] {
  const seen = new Set<string>();
  return annotations.filter((a) => {
    if (typeof a.groupId !== 'string') return true;
    if (seen.has(a.groupId)) return false;
    seen.add(a.groupId);
    return true;
  });
}

/** How many marks a document holds. See `DocumentMeta.annotationCount`. */
export function countMarks(annotations: StoredAnnotation[]): number {
  return oneEntryPerMark(annotations).length;
}

/** How many marks sit under each theme id; a mark under several themes counts under each. */
export function computeThemeCounts(annotations: StoredAnnotation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of oneEntryPerMark(annotations)) {
    for (const t of themeIdsOf(a)) counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

/** How many of this document's annotations are marked terminology. See `DocumentMeta.terminologyCount`. */
export function countTerminology(annotations: StoredAnnotation[]): number {
  return oneEntryPerMark(annotations).filter((a) => a.isTerminology === true).length;
}

export interface SaveDocumentParams {
  title: string;
  text: string;
  format: string;
  filename?: string;
  layout?: 'verbatim';
  textStyles?: TextStyle[];
}

/** The fields a caller is allowed to change on an existing document. */
export interface UpdateDocumentParams {
  title?: string;
  annotations?: StoredAnnotation[];
  readingState?: ReadingState;
  /** One progress report; the stored furthest point is kept. Invalid reports change nothing. */
  readingProgress?: { position: number; total: number };
  /** Restores `annotationsBackup` over the live set. Used by the recovery endpoint. */
  restoreAnnotationsBackup?: true;
}

/** One rotating backup of a document's marks: `id` is its timestamp (ms) as a string. */
export interface MarkBackupInfo {
  id: string;
  savedAt: string;
  markCount: number;
}

export interface DocumentBackend {
  /** Human-readable name of this backend, surfaced in startup logs. */
  readonly name: string;
  /** Absolute path of the directory documents are written to, shown in the UI. */
  readonly location: string;
  saveDocument(params: SaveDocumentParams): Promise<DocumentMeta>;
  attachOriginal(id: string, original: Buffer, filename?: string): Promise<boolean>;
  getDocument(id: string): Promise<StoredDocument | null>;
  getOriginal(id: string): Promise<{ buffer: Buffer; filename: string } | null>;
  listDocuments(): Promise<DocumentMeta[]>;
  updateDocument(id: string, params: UpdateDocumentParams): Promise<DocumentMeta | null>;
  deleteDocument(id: string): Promise<boolean>;
  /**
   * Edits a stored PDF and its marks as one locked step: `edit` gets the current bytes and marks
   * (read inside the lock) and returns both changed. Returns `result`, or null if the document
   * or its original is missing. Keeps the previous PDF as `originals/{id}.prev`.
   */
  editPdfPages<T>(id: string, edit: (input: PdfPageEditInput) => Promise<PdfPageEditOutput<T>>): Promise<T | null>;
  /** Up to 5 time-spaced mark backups, newest first. `[]` for an unknown id. */
  listMarkBackups(id: string): Promise<MarkBackupInfo[]>;
  /** Puts a backup back (the live set becomes a backup first). Null if document or backup is missing. */
  restoreMarkBackup(id: string, backupId: string): Promise<DocumentMeta | null>;
  /** Document closed/left: back up its live marks if changed since the newest backup. */
  checkpointMarkBackup(id: string): Promise<boolean>;
  /** App quit: checkpoint every document whose changes the 10-minute window skipped. */
  checkpointPendingMarkBackups(): Promise<number>;
  /** Deletes every document past its retention window; returns how many were removed. */
  sweepExpiredDocuments(): Promise<number>;
  /**
   * The reader's preferences (name, theme colours, palettes, typography, …), or null if none have
   * been saved yet. Kept alongside the document library rather than in the browser's localStorage
   * because the desktop build's embedded server binds to a fresh random port every launch (see
   * server.ts) — a different port is a different origin to the browser, so localStorage would
   * silently reset on every restart and every auto-update. This file, like the library itself,
   * lives in the OS per-user application-data directory and survives both.
   */
  getSettings(): Promise<Record<string, unknown> | null>;
  /** Merges `patch` into the stored settings, under the same lock as `saveClientSettings`. */
  saveSettings(patch: Record<string, unknown>): Promise<void>;
  /** Merges the client's settings into the stored ones; `gemini*` fields are never changed here. */
  saveClientSettings(incoming: Record<string, unknown>): Promise<void>;
}

/**
 * How long a document survives before the sweeper removes it, or 0 for "keep forever" — the
 * default.
 *
 * Retention is deliberately OFF unless asked for. This store holds the user's own library on
 * their own machine, and they delete from it explicitly through the library panel; a timer
 * that quietly erased documents they had not opened in a week would be data loss, not
 * housekeeping. Set MARGINALIA_RETENTION_DAYS to a positive number to opt back in.
 */
export const RETENTION_DAYS = Math.max(0, Number(process.env.MARGINALIA_RETENTION_DAYS || 0) || 0);

/**
 * Rejects any id that isn't one we generated. Ids arrive straight off the URL and are joined
 * into a filesystem path — without this, an id like `../../etc/passwd` could read or delete
 * something well outside the store.
 */
export function isValidId(id: string): boolean {
  return /^[a-f0-9]{32}$/.test(id);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * The extension to store a file under. Only the extension is taken from the user's filename —
 * the rest of the stored name is our own generated id, so a hostile filename can never steer
 * the write outside the store.
 */
export function safeExtension(filename: string): string {
  const match = /\.[^./\\]+$/.exec(filename || '');
  if (!match) return '';
  return match[0].replace(/[^.a-zA-Z0-9]/g, '').slice(0, 12);
}

export function buildMeta(id: string, params: SaveDocumentParams): DocumentMeta {
  const now = new Date();
  return {
    id,
    title: params.title || 'Untitled Document',
    format: params.format || 'TXT',
    filename: params.filename || `${params.title || 'document'}.${(params.format || 'txt').toLowerCase()}`,
    wordCount: countWords(params.text),
    originalBytes: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: RETENTION_DAYS > 0 ? new Date(now.getTime() + RETENTION_DAYS * 864e5).toISOString() : null,
    annotationCount: 0,
    themeIds: [],
    themeCounts: {},
    terminologyCount: 0,
    progressPercent: null,
    ...(params.layout === 'verbatim' && { layout: 'verbatim' as const })
  };
}

/** A Gemini setting (key, model, …): server-only. Any case, matching the client's settingsCache filter. */
export const isGeminiKey = (key: string): boolean => /^gemini/i.test(key);

/**
 * Settings as the renderer may see them: every `gemini*` field removed, so the API key never
 * reaches the client. Settings asks `/api/gemini-config` whether a key is configured instead.
 */
export function publicSettings(settings: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!settings) return settings;
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !isGeminiKey(key)));
}

/**
 * How far the reader has got in a document. `position`/`total` are the last report in whatever
 * unit the reader uses (PDF: page of pages; text: paragraph of paragraphs). `furthest` is the
 * furthest fraction (0–1) ever reached, so a PDF that gains or loses pages keeps a sane value.
 */
export interface ReadingProgress {
  position: number;
  total: number;
  furthest: number;
}

/** Applies one progress report. Null when the report is invalid. */
export function nextReadingProgress(
  prev: ReadingProgress | null,
  report: { position: number; total: number }
): ReadingProgress | null {
  const { position, total } = report ?? ({} as Partial<ReadingProgress>);
  if (!isFiniteNumber(position) || !isFiniteNumber(total) || total <= 0 || position < 0) return null;
  const clamped = Math.min(position, total);
  const before = prev && isFiniteNumber(prev.furthest) ? prev.furthest : 0;
  return { position: clamped, total, furthest: Math.min(1, Math.max(before, clamped / total)) };
}

/** The library's "N% completed": the furthest point, rounded, 0–100; null when never read. */
export function progressPercent(progress: ReadingProgress | null): number | null {
  if (!progress || !isFiniteNumber(progress.furthest)) return null;
  return Math.round(Math.min(1, Math.max(0, progress.furthest)) * 100);
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A document name as typed, tidied: one line, trimmed, at most 300 characters; null when empty. */
export function cleanTitle(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const title = input.replace(/\s+/g, ' ').trim().slice(0, 300).trim();
  return title || null;
}
