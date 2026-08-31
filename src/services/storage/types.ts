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
 * Which theme each annotation belongs to, keyed by annotation id.
 *
 * Kept beside the annotations rather than inside them for two reasons. The editor owns the
 * annotation objects and round-trips them verbatim, so writing app fields into them risks being
 * dropped or colliding with a future version of its schema. And a theme has to survive the mark's
 * colour being changed later — tagging by id rather than inferring from colour is what makes that
 * possible.
 */
export type ThemeTags = Record<string, string>;

export interface StoredDocument extends DocumentMeta {
  text: string;
  annotations: StoredAnnotation[];
  themeTags: ThemeTags;
}

export interface SaveDocumentParams {
  title: string;
  text: string;
  format: string;
  filename?: string;
}

/** The fields a caller is allowed to change on an existing document. */
export interface UpdateDocumentParams {
  title?: string;
  annotations?: StoredAnnotation[];
  themeTags?: ThemeTags;
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
  /** Deletes every document past its retention window; returns how many were removed. */
  sweepExpiredDocuments(): Promise<number>;
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
    annotationCount: 0
  };
}
