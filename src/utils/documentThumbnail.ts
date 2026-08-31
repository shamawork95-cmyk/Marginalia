/**
 * First-page thumbnails for the library shelf.
 *
 * The cards used to show a coloured monogram because there was nothing better to show. There is
 * now: every format the workspace can open (PDF, and HTML — which is printed to a PDF at import
 * time) has a real paginated original on disk, so page one can simply be rendered. A shelf of
 * actual first pages is scannable in a way a column of identical green tiles is not.
 *
 * Rendering happens in the renderer with the same pdf.js the workspace uses, and results are
 * cached twice over: in a module-level map so re-renders of the library are free, and in
 * `sessionStorage` so navigating away and back does not re-decode every book. The cache key
 * carries `updatedAt`, so a document that changes gets a fresh cover rather than a stale one.
 *
 * Only two pages are decoded at a time. A library of thirty books would otherwise start thirty
 * pdf.js loading tasks at once and lock the interface up while the shelf paints.
 */

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import { originalDocumentUrl } from './documentStorage';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

/** Matches the workspace: scanned books need the WASM decoders or every page renders blank. */
const PDF_WASM_URL = '/pdf-wasm/';

/** Wide enough to stay sharp on a retina card at the sizes the shelf uses. */
const THUMBNAIL_WIDTH = 520;

const MAX_CONCURRENT = 2;

const memoryCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();
let active = 0;
const queue: Array<() => void> = [];

function cacheKey(id: string, updatedAt: string): string {
  return `marginalia:thumb:${id}:${updatedAt}`;
}

function readSession(key: string): string | null | undefined {
  try {
    const stored = sessionStorage.getItem(key);
    return stored === null ? undefined : stored;
  } catch {
    return undefined;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // A full quota is not worth failing a cover over; the memory cache still holds it.
  }
}

async function takeSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active += 1;
}

function releaseSlot(): void {
  active -= 1;
  queue.shift()?.();
}

async function renderFirstPage(id: string): Promise<string | null> {
  await takeSlot();
  const task = getDocument({ url: originalDocumentUrl(id, 'inline'), wasmUrl: PDF_WASM_URL });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return null;

    // Pages are transparent where they are unpainted, which would show the card's dark
    // background through the paper in dark mode.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  } finally {
    releaseSlot();
    void task.destroy();
  }
}

/**
 * A data URL for the document's first page, or null when there is no page to render — a DOCX,
 * EPUB or pasted text, or an original whose bytes never made it to disk. Callers fall back to
 * the monogram cover in that case.
 */
export async function documentThumbnail(doc: {
  id: string;
  format: string;
  originalBytes: number;
  updatedAt: string;
}): Promise<string | null> {
  const key = cacheKey(doc.id, doc.updatedAt);

  if (memoryCache.has(key)) return memoryCache.get(key) ?? null;

  const stored = readSession(key);
  if (stored !== undefined) {
    memoryCache.set(key, stored || null);
    return stored || null;
  }

  const renderable = (doc.format === 'PDF' || doc.format === 'HTML') && doc.originalBytes > 0;
  if (!renderable) {
    memoryCache.set(key, null);
    return null;
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const work = renderFirstPage(doc.id).then((dataUrl) => {
    memoryCache.set(key, dataUrl);
    // Only successes are persisted: a failure may have been a server that had not come up yet,
    // and caching that for the session would leave the card blank until a reload.
    if (dataUrl) writeSession(key, dataUrl);
    inFlight.delete(key);
    return dataUrl;
  });
  inFlight.set(key, work);
  return work;
}
