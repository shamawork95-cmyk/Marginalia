/**
 * Client side of the local document store (see `src/services/documentStore.ts` for the server
 * half). Documents live on the machine's own filesystem instead of in the browser, so the app
 * is not bounded by the ~5MB `sessionStorage` quota, the original uploaded file is kept rather
 * than discarded the moment it is parsed, and annotations survive restarts. The browser holds
 * only an id and a bit of metadata; text, originals and annotations are fetched on demand.
 */

/**
 * One stored annotation. Deliberately opaque: the store round-trips these records verbatim and
 * never interprets them, so it does not need to model whatever the reader writes into them.
 */
export type Annotation = { id: string; [key: string]: unknown };

export interface StoredDocumentMeta {
  id: string;
  title: string;
  format: string;
  filename: string;
  wordCount: number;
  originalBytes: number;
  createdAt: string;
  updatedAt: string;
  /** Null when retention is off, which is the default — the document is kept until deleted. */
  expiresAt: string | null;
  annotationCount: number;
  retentionDays?: number;
}

export interface StorageInfo {
  backend: string;
  /** Absolute path documents are written to, shown to the user in the library panel. */
  location: string;
  retentionDays: number;
}

/**
 * Uploads one parsed document: its extracted text as JSON, then the original file's raw bytes.
 *
 * Two requests, deliberately. A document's text is far too large to ride in a query string
 * (Node caps request headers at ~16KB, so anything past ~3,000 words is rejected outright),
 * and base64-ing the file into the JSON would inflate it by a third. Sending each in the shape
 * that suits it keeps both effectively unbounded.
 *
 * Unlike before, attaching the original is NOT best-effort for PDFs: the workspace renders the
 * real file, so a PDF whose bytes failed to store would open to an empty viewer. The error is
 * surfaced instead of swallowed, and the caller decides what to do about it.
 */
export async function storeUploadedDocument(params: {
  file: File;
  title: string;
  text: string;
  format: string;
}): Promise<StoredDocumentMeta> {
  const meta = await storePastedDocument({
    title: params.title,
    text: params.text,
    format: params.format,
    filename: params.file.name
  });

  const res = await fetch(
    `/api/documents/${meta.id}/original?filename=${encodeURIComponent(params.file.name)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await params.file.arrayBuffer()
    }
  );
  if (!res.ok) {
    throw new Error('The document was saved, but its original file could not be stored.');
  }

  return { ...meta, originalBytes: params.file.size };
}

/** Stores a document that has no original file behind it — text pasted straight into the app. */
export async function storePastedDocument(params: {
  title: string;
  text: string;
  format?: string;
  filename?: string;
}): Promise<StoredDocumentMeta> {
  const res = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: params.title,
      text: params.text,
      format: params.format || 'TXT',
      filename: params.filename
    })
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || 'Failed to store the document on this device.');
  }
  return res.json();
}

/**
 * Re-fetches a stored document's text. Returns null when the document is gone — because it was
 * deleted from the library, or retired by the sweeper if retention was turned on — so callers
 * can tell that apart from a genuine failure.
 */
export async function fetchDocumentText(id: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/documents/${id}`);
    if (!res.ok) return null;
    const doc = await res.json();
    return typeof doc.text === 'string' ? doc.text : null;
  } catch {
    return null;
  }
}

/** Every document currently on disk, newest activity first. Backs the library panel. */
export async function listStoredDocuments(): Promise<StoredDocumentMeta[]> {
  try {
    const res = await fetch('/api/documents');
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.documents) ? body.documents : [];
  } catch {
    return [];
  }
}

/** Renames a stored document. Returns null if it is no longer there. */
export async function renameStoredDocument(id: string, title: string): Promise<StoredDocumentMeta | null> {
  try {
    const res = await fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * URL for the original uploaded file.
 *
 * `inline` is what the PDF workspace loads: it makes the server send the file with its real
 * content type instead of as a download, which is what PDF.js needs to render the actual pages.
 */
export function originalDocumentUrl(id: string, disposition: 'inline' | 'attachment' = 'attachment'): string {
  return `/api/documents/${id}/original${disposition === 'inline' ? '?disposition=inline' : ''}`;
}

/** Which theme each annotation belongs to, keyed by annotation id. */
export type ThemeTags = Record<string, string>;

export interface StoredAnnotationSet {
  annotations: Annotation[];
  themeTags: ThemeTags;
}

export async function fetchAnnotations(id: string): Promise<StoredAnnotationSet> {
  try {
    const res = await fetch(`/api/documents/${id}/annotations`);
    if (!res.ok) return { annotations: [], themeTags: {} };
    const body = await res.json();
    return {
      annotations: Array.isArray(body.annotations) ? body.annotations : [],
      themeTags: body.themeTags && typeof body.themeTags === 'object' ? body.themeTags : {}
    };
  } catch {
    return { annotations: [], themeTags: {} };
  }
}

/**
 * Writes the document's complete annotation set to disk, replacing what was there.
 *
 * The client holds the authoritative set and re-sends all of it after each edit. That is a
 * little wasteful per keystroke — which is why callers debounce — but it removes any chance of
 * the on-disk set drifting out of sync with what the reader can see.
 */
export async function saveAnnotations(
  id: string,
  annotations: Annotation[],
  themeTags: ThemeTags = {}
): Promise<boolean> {
  try {
    const res = await fetch(`/api/documents/${id}/annotations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // Tags go with the annotations they describe, in one write, so the two cannot drift apart.
      body: JSON.stringify({ annotations, themeTags })
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Deletes a document from this device permanently — its record, its original file and its
 * annotations. There is no undo, which is why the library panel confirms first.
 */
export async function deleteStoredDocument(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body.deleted);
  } catch {
    return false;
  }
}

/** Where documents are being written, so the library can show the user the real folder. */
export async function fetchStorageInfo(): Promise<StorageInfo | null> {
  try {
    const res = await fetch('/api/storage');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Result of asking the desktop shell to change where documents are stored. */
export interface StorageChangeResult {
  changed: boolean;
  path?: string;
  /** How many files were copied across, when the user chose to move their library. */
  moved?: number;
  error?: string;
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  defaultStorageDir: string;
}

/**
 * The desktop bridge exposed by `electron/preload.cjs`, or null when not running in the desktop
 * app. Settings uses its absence to hide controls that only the shell can perform — picking a
 * folder needs a native dialog, which a page cannot open.
 */
export interface DesktopBridge {
  isDesktop: boolean;
  getStorageDir(): Promise<string>;
  revealStorageDir(): Promise<void>;
  chooseStorageDir(): Promise<StorageChangeResult>;
  resetStorageDir(): Promise<StorageChangeResult>;
  getAppInfo(): Promise<AppInfo>;
}

export function desktopBridge(): DesktopBridge | null {
  return (window as unknown as { marginaliaDesktop?: DesktopBridge }).marginaliaDesktop ?? null;
}
