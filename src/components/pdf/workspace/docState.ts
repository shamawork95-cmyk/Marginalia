/**
 * The PDF workspace's constants and its per-document view state (zoom, page, pages in view) kept in
 * localStorage as the fast first read. Shared by PdfWorkspace and its hooks (moved verbatim).
 */

import { PDF_VIEW_MODES, type ReadingState } from '../../../utils/documentStorage';

/**
 * Where PDF.js finds its WebAssembly image decoders.
 *
 * Scanned books are very often JPEG 2000 or JBIG2 — both formats PDF.js decodes in WASM, and
 * both of which fail SILENTLY when the binaries cannot be found: the page renders, the text layer
 * builds, and every page comes out blank white with nothing logged. A 758-page Urdu scan did
 * exactly that. The directory is served unhashed by the `pdfjsWasm` plugin in `vite.config.ts`.
 */
export const PDF_WASM_URL = '/pdf-wasm/';

/** How long to wait after the last change before writing to disk. */
export const SAVE_DEBOUNCE_MS = 700;

/** Narrower than this, spread view scrolls its pairs instead of showing one open book. */
export const MIN_BOOK_WIDTH = 700;

/** The zoom a document opens at when nothing was remembered about it yet. */
export const DEFAULT_ZOOM = 1.25;

/**
 * What the instance navigator occupies at the foot of the window, pill plus its margin.
 *
 * Floating panels are told to stay above it. Staying inside the viewport is not the same as
 * staying out of the way: a properties strip clamped to the bottom edge landed on top of the
 * navigator and buried the controls the reader was mid-way through using.
 */
export const NAVIGATOR_HEIGHT = 60;

/** Wheel-zoom bounds — the same floor and ceiling `fitWidth` and the toolbar's own zoom steps
 *  already clamp to, so scrolling to zoom never reaches a size the rest of the app disagrees with. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

/** Where each document's last zoom level and page are remembered between sessions. */
export const DOC_STATE_PREFIX = 'marginalia_docstate_';

export type StoredDocState = ReadingState;

/**
 * The fast, synchronous first read — localStorage resolves before any network round trip could,
 * so it is what the very first render uses. It is not the durable copy: see `fetchReadingState`
 * and the hydration effect below for why the server's copy wins once it loads.
 */
export function loadDocState(docId: string): StoredDocState | null {
  try {
    const raw = localStorage.getItem(DOC_STATE_PREFIX + docId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.scale === 'number' && typeof parsed.page === 'number') {
      return { scale: parsed.scale, page: parsed.page, viewMode: PDF_VIEW_MODES.includes(parsed.viewMode) ? parsed.viewMode : 'single' };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveDocState(docId: string, state: StoredDocState) {
  try {
    localStorage.setItem(DOC_STATE_PREFIX + docId, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
