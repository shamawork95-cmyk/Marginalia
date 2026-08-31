/**
 * Document store facade.
 *
 * Documents are stored on the local machine's own filesystem — the extracted text plus
 * metadata as one JSON file, the original uploaded file byte-for-byte beside it, and the
 * reader's annotations alongside both. Nothing leaves the device. Keeping the original means
 * the PDF workspace can re-render the real document rather than only the text scraped out of
 * it at parse time.
 *
 * Configure with:
 *   MARGINALIA_STORE_DIR        overrides the store root; the desktop build points this at the
 *                               OS per-user application-data directory
 *   MARGINALIA_RETENTION_DAYS   opt-in auto-expiry, off by default (see RETENTION_DAYS)
 */

import { DocumentBackend, RETENTION_DAYS } from './storage/types';
import { LocalDocumentBackend } from './storage/localBackend';

export type { DocumentMeta, StoredDocument, StoredAnnotation, ThemeTags, UpdateDocumentParams } from './storage/types';
export { RETENTION_DAYS } from './storage/types';

/** How often the sweeper runs, when retention is enabled at all. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let backend: DocumentBackend | null = null;

/**
 * The active backend, created once on first use. Resolved lazily rather than at import time so
 * the environment — `dotenv` in development, the Electron main process in the packaged app —
 * has certainly set the store root before it is read.
 */
export function getBackend(): DocumentBackend {
  if (!backend) {
    backend = new LocalDocumentBackend(process.env.MARGINALIA_STORE_DIR);
  }
  return backend;
}

/**
 * Re-points the store at a different directory while the app is running.
 *
 * Backs the "change storage folder" action in Settings. The backend is discarded rather than
 * mutated so the next call rebuilds it against the new root, and the environment variable is
 * updated too so anything resolving the backend later agrees on the location.
 *
 * This only re-points; it does not move existing files. Copying the library across is the
 * desktop shell's job, because only it can ask the user whether they want that (see
 * `electron/main.cjs`).
 */
export function setStoreDirectory(directory: string): void {
  process.env.MARGINALIA_STORE_DIR = directory;
  backend = null;
}

export const saveDocument: DocumentBackend['saveDocument'] = (params) => getBackend().saveDocument(params);
export const attachOriginal: DocumentBackend['attachOriginal'] = (id, original, filename) =>
  getBackend().attachOriginal(id, original, filename);
export const getDocument: DocumentBackend['getDocument'] = (id) => getBackend().getDocument(id);
export const getOriginal: DocumentBackend['getOriginal'] = (id) => getBackend().getOriginal(id);
export const listDocuments: DocumentBackend['listDocuments'] = () => getBackend().listDocuments();
export const updateDocument: DocumentBackend['updateDocument'] = (id, params) =>
  getBackend().updateDocument(id, params);
export const deleteDocument: DocumentBackend['deleteDocument'] = (id) => getBackend().deleteDocument(id);
export const sweepExpiredDocuments: DocumentBackend['sweepExpiredDocuments'] = () =>
  getBackend().sweepExpiredDocuments();

/**
 * Starts the retention sweeper, or does nothing when retention is disabled — which is the
 * default, since the library is the user's own and is emptied by the delete button rather than
 * by a timer. Returns null in that case so the caller can report that no sweeper is running.
 *
 * `unref()` keeps the timer from holding the process open on shutdown.
 */
export function startDocumentSweeper(): NodeJS.Timeout | null {
  if (RETENTION_DAYS <= 0) return null;

  const run = () => {
    sweepExpiredDocuments()
      .then((count) => {
        if (count > 0) {
          console.log(`[Marginalia] Sweeper removed ${count} document(s) past ${RETENTION_DAYS}-day retention.`);
        }
      })
      .catch((err) => console.warn('[Marginalia] Document sweep failed:', err));
  };

  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
