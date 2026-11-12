/**
 * Locks down the offscreen window that prints imported HTML to PDF.
 *
 * The HTML is an untrusted book file. The server strips what it can (src/services/htmlSanitize.ts);
 * this is the second layer: the window cannot navigate away and cannot fetch anything that is not
 * its own temp file (exactly that path, not any other `file:`) or inline `data:`. That stops
 * tracking pixels, remote fonts/CSS, redirects, reads of other local files and any request to the
 * app's own local API.
 */

const path = require('path');
const { fileURLToPath } = require('url');

/** Its own in-memory session, so blocking requests here never touches the main window's. */
const RENDER_PARTITION = 'marginalia-render';

/** Paths compare case-insensitively on Windows (drive letters, NTFS). */
const samePathKey = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

/** `data:` always; `file:` only for a path in `allowedPaths` (the temp files being printed). */
function isRenderRequestAllowed(url, allowedPaths) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'data:') return true;
  if (parsed.protocol !== 'file:') return false;
  let filePath;
  try {
    filePath = fileURLToPath(parsed);
  } catch {
    return false;
  }
  // Both sides normalised, so a path registered in any spelling (drive-letter case on Windows) matches.
  const key = samePathKey(filePath);
  for (const p of allowedPaths) if (samePathKey(p) === key) return true;
  return false;
}

const guardedSessions = new WeakSet();
/** Temp files of the render windows open right now. The render session is shared, so this is too. */
const allowedPaths = new Set();

/** Locks `win` down to `tmpFile` (+ `data:`). Returns a release to call when the window is done. */
function guardRenderWindow(win, tmpFile) {
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-redirect', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const key = samePathKey(tmpFile);
  allowedPaths.add(key);
  const session = win.webContents.session;
  if (!guardedSessions.has(session)) {
    guardedSessions.add(session);
    session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isRenderRequestAllowed(details.url, allowedPaths) });
    });
  }
  return () => allowedPaths.delete(key);
}

module.exports = { RENDER_PARTITION, isRenderRequestAllowed, guardRenderWindow };
