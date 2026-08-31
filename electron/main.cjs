/**
 * Electron main process — the desktop shell around Marginalia.
 *
 * The app is the same Express server and React client that run on the web, hosted inside
 * Electron rather than reimplemented for it. On launch this process:
 *
 *   1. Points the document store at the OS's per-user application-data directory, so a user's
 *      library lives with their account rather than next to wherever the executable sits (which
 *      on Windows and macOS is often a read-only location).
 *   2. Registers Electron's own Chromium as the HTML-to-PDF renderer, so the installer does not
 *      have to carry Puppeteer's separate Chrome download.
 *   3. Starts the server on an OS-assigned port and only then opens a window pointed at it.
 *
 * Requiring a built server: `dist/server.cjs` is produced by `npm run build`. Both
 * `npm run desktop` and the packaged app build it first.
 */

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

/**
 * Where the app remembers the user's chosen library folder.
 *
 * Kept in its own small file rather than in the renderer's preferences, because the store root
 * has to be known before the server module is even loaded — long before any UI exists to read
 * preferences from.
 */
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

/** The default library location: per-user and writable on every platform Electron targets. */
const DEFAULT_STORE_DIR = path.join(app.getPath('userData'), 'library');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// The store root must be set before the server module is loaded, because the backend reads it
// when it first resolves.
let storeDir = readConfig().storeDir || DEFAULT_STORE_DIR;
process.env.MARGINALIA_STORE_DIR = storeDir;

// Serve the built client rather than starting Vite, and tell the server not to listen on its
// own — this process calls startServer() itself so it can await the port.
process.env.NODE_ENV = 'production';
process.env.MARGINALIA_EMBEDDED = '1';
process.env.PORT = '0';

/** Where `dist` ends up: inside the asar archive when packaged, in the repo when not. */
const DIST_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar', 'dist')
  : path.join(__dirname, '..', 'dist');

let mainWindow = null;
let serverPort = null;
/** The loaded server module, kept so IPC handlers can re-point the store at runtime. */
let serverModule = null;

/**
 * Renders HTML to PDF using an offscreen Electron window.
 *
 * Electron already bundles Chromium, so using it here gives the desktop build full print fidelity
 * without shipping a second browser. `data:` URLs cap out well below the size of a long annotated
 * document, so the HTML goes through a temp file instead.
 */
async function renderPdfWithElectron(options) {
  const tmpFile = path.join(app.getPath('temp'), `marginalia-export-${Date.now()}.html`);
  await fs.promises.writeFile(tmpFile, options.html, 'utf-8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: true }
  });

  try {
    await win.loadFile(tmpFile);

    // The exported page's own inline script measures each sticky note's anchor and draws its
    // arrow only once fonts and layout have settled, flagging that with
    // `window.__marginaliaLayoutReady`. Printing before it finishes captures half-drawn arrows.
    // The poll is bounded so a page with no notes, or a script that throws, still exports.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const ready = await win.webContents
        .executeJavaScript('window.__marginaliaLayoutReady === true')
        .catch(() => false);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Electron takes margins in inches, so the millimetres from the server convert here.
    const mmToIn = (mm) => mm / 25.4;
    return await win.webContents.printToPDF({
      pageSize: options.pageSize || 'A4',
      printBackground: true, // Needed so highlights survive into the PDF.
      displayHeaderFooter: options.displayHeaderFooter,
      headerTemplate: options.headerTemplate,
      footerTemplate: options.footerTemplate,
      margins: {
        marginType: 'custom',
        top: mmToIn(options.marginsMm.top),
        right: mmToIn(options.marginsMm.right),
        bottom: mmToIn(options.marginsMm.bottom),
        left: mmToIn(options.marginsMm.left)
      }
    });
  } finally {
    win.destroy();
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

async function startEmbeddedServer() {
  const serverPath = path.join(DIST_PATH, 'server.cjs');
  if (!fs.existsSync(serverPath)) {
    throw new Error(
      `The built server was not found at ${serverPath}. Run "npm run build" before starting the desktop app.`
    );
  }

  serverModule = require(serverPath);
  serverModule.setHtmlToPdfRenderer(renderPdfWithElectron);
  return serverModule.startServer({ staticRoot: DIST_PATH });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f9f9f7',
    // Keeps the traffic lights in place on macOS while letting the app's own header occupy the
    // title bar area, which is where the desktop build's chrome lives.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // The renderer is our own client, but it loads over HTTP and parses user-supplied PDFs,
      // so it stays sandboxed with no direct Node access. Anything privileged goes through the
      // narrow IPC surface in preload.cjs.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  /**
   * External links open in the user's real browser instead of replacing the app window — but
   * only http(s) ones.
   *
   * `shell.openExternal` hands the URL to the operating system, which will happily act on
   * `file://` or on whatever custom protocol some other installed application has registered.
   * Passing an unvalidated URL there turns any link in the page into a way to launch things
   * outside the app, so the scheme is checked first.
   */
  const openExternalIfSafe = (url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    }
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });

  /**
   * Keeps the window on the app.
   *
   * Without this, a navigation — a stray link, or a redirect inside a document — would replace
   * the running application with whatever it pointed at, in a window that still has the preload
   * bridge attached. Anything that is not the local app is refused and sent to the browser.
   */
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.host !== `127.0.0.1:${serverPort}`) {
      event.preventDefault();
      openExternalIfSafe(url);
    }
  });

  // Nothing in this app embeds third-party frames, so any attempt to attach one is refused.
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Storage location ─────────────────────────────────────────────────────────
ipcMain.handle('marginalia:storage-dir', () => storeDir);

ipcMain.handle('marginalia:reveal-storage-dir', async () => {
  await fs.promises.mkdir(storeDir, { recursive: true });
  shell.openPath(storeDir);
});

/**
 * Copies an existing library into a new location.
 *
 * Copy-then-delete rather than `fs.rename`, because the two folders are very often on different
 * volumes — moving the library to an external drive is one of the main reasons to change it at
 * all — and rename fails across devices. The originals are only removed once the copy has
 * finished, so an interrupted move leaves the old library intact rather than losing documents.
 */
async function migrateLibrary(from, to) {
  if (!fs.existsSync(from)) return { moved: 0 };
  await fs.promises.mkdir(to, { recursive: true });

  let moved = 0;
  for (const sub of ['documents', 'originals']) {
    const sourceDir = path.join(from, sub);
    if (!fs.existsSync(sourceDir)) continue;
    await fs.promises.mkdir(path.join(to, sub), { recursive: true });
    for (const name of await fs.promises.readdir(sourceDir)) {
      await fs.promises.copyFile(path.join(sourceDir, name), path.join(to, sub, name));
      moved++;
    }
  }

  for (const sub of ['documents', 'originals']) {
    await fs.promises.rm(path.join(from, sub), { recursive: true, force: true }).catch(() => {});
  }
  return { moved };
}

/**
 * Asks the user for a new library folder, optionally moves the existing documents into it, and
 * re-points the running store — no restart needed.
 */
ipcMain.handle('marginalia:choose-storage-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where Marginalia stores your documents',
    defaultPath: storeDir,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Use This Folder'
  });
  if (result.canceled || !result.filePaths[0]) return { changed: false };

  const chosen = result.filePaths[0];
  if (chosen === storeDir) return { changed: false };

  // Writability is checked up front. Discovering the folder is read-only only when the next
  // document failed to save would look like data loss rather than a bad choice of folder.
  try {
    await fs.promises.mkdir(chosen, { recursive: true });
    await fs.promises.access(chosen, fs.constants.W_OK);
  } catch {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      message: 'That folder cannot be written to.',
      detail: 'Choose a different folder, or adjust its permissions and try again.'
    });
    return { changed: false, error: 'not-writable' };
  }

  let movedCount = 0;
  const hasExisting = fs.existsSync(path.join(storeDir, 'documents'));
  if (hasExisting) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Move My Documents', 'Start Empty Here', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Move your existing documents to the new folder?',
      detail:
        'Moving copies every document, original file and annotation across, then removes them ' +
        'from the old folder. Starting empty leaves the old folder untouched — those documents ' +
        'will simply no longer appear in Marginalia.'
    });
    if (response === 2) return { changed: false };
    if (response === 0) {
      try {
        ({ moved: movedCount } = await migrateLibrary(storeDir, chosen));
      } catch (err) {
        await dialog.showMessageBox(mainWindow, {
          type: 'error',
          message: 'Your documents could not be moved.',
          detail: String((err && err.message) || err)
        });
        return { changed: false, error: 'migration-failed' };
      }
    }
  }

  storeDir = chosen;
  writeConfig({ ...readConfig(), storeDir });
  serverModule?.setStoreDirectory(storeDir);

  return { changed: true, path: storeDir, moved: movedCount };
});

/** Puts the library back in the default per-user location. */
ipcMain.handle('marginalia:reset-storage-dir', async () => {
  if (storeDir === DEFAULT_STORE_DIR) return { changed: false, path: storeDir };
  const previous = storeDir;
  await migrateLibrary(previous, DEFAULT_STORE_DIR).catch(() => {});
  storeDir = DEFAULT_STORE_DIR;
  writeConfig({ ...readConfig(), storeDir: undefined });
  serverModule?.setStoreDirectory(storeDir);
  return { changed: true, path: storeDir };
});

// ── App info, for the About section in Settings ───────────────────────────────
ipcMain.handle('marginalia:app-info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
  defaultStorageDir: DEFAULT_STORE_DIR
}));

// ── Auto-update ─────────────────────────────────────────────────────────────
/**
 * An update only ever replaces the installed application binaries. The library and every user
 * setting live in `app.getPath('userData')` — outside the install directory on every platform
 * this app targets — so a new build landing has nothing to do with them; they are simply still
 * there, untouched, the next time the app starts.
 *
 * Status changes are pushed to the renderer as they happen (rather than polled) so the Settings
 * screen's update panel reflects a check or download that started automatically on launch, before
 * any UI existed to request one.
 */
function broadcastUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('marginalia:updater-status', status);
  }
}

autoUpdater.autoDownload = true;
// Left at the default of true: if a downloaded update is never actioned from Settings, it installs
// itself the next time the user quits, rather than leaving them on a stale build indefinitely.
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => broadcastUpdateStatus({ state: 'checking' }));
autoUpdater.on('update-available', (info) =>
  broadcastUpdateStatus({ state: 'available', version: info.version })
);
autoUpdater.on('update-not-available', () => broadcastUpdateStatus({ state: 'not-available' }));
autoUpdater.on('download-progress', (progress) =>
  broadcastUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) })
);
autoUpdater.on('update-downloaded', (info) =>
  broadcastUpdateStatus({ state: 'downloaded', version: info.version })
);
autoUpdater.on('error', (err) =>
  broadcastUpdateStatus({ state: 'error', message: String((err && err.message) || err) })
);

let updateCheckTimer = null;

/**
 * (Re)schedules background checks around the user's preference. Called on launch and again
 * whenever the preference changes, so turning automatic updates off in Settings takes effect
 * immediately instead of after a restart.
 */
function scheduleAutoUpdateChecks() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  // A dev run has no packaged update feed to check against — electron-updater would only error.
  if (!app.isPackaged || readConfig().autoUpdateEnabled === false) return;

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10_000);
  updateCheckTimer = setInterval(check, 4 * 60 * 60 * 1000);
}

ipcMain.handle('marginalia:updater-check', async () => {
  if (!app.isPackaged) {
    broadcastUpdateStatus({ state: 'not-available' });
    return;
  }
  await autoUpdater.checkForUpdates().catch(() => {});
});

/** Installs a downloaded update and relaunches — the only step that ever needs a restart. */
ipcMain.handle('marginalia:updater-quit-and-install', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('marginalia:updater-get-preference', () => readConfig().autoUpdateEnabled !== false);

ipcMain.handle('marginalia:updater-set-preference', (_event, enabled) => {
  writeConfig({ ...readConfig(), autoUpdateEnabled: !!enabled });
  scheduleAutoUpdateChecks();
});

// A second launch focuses the window that is already open rather than starting a second server
// and a second copy of the library.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      serverPort = await startEmbeddedServer();
      createWindow();
      scheduleAutoUpdateChecks();
    } catch (err) {
      dialog.showErrorBox('Marginalia could not start', String(err && err.message ? err.message : err));
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverPort) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
