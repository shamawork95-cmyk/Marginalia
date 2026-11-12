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
const { tryMigrateLibrary } = require('./storage.cjs');
const { RENDER_PARTITION, guardRenderWindow } = require('./renderGuard.cjs');
const { requestFlush, createExitGuard, flushThenCheckpoint } = require('./flushOnExit.cjs');
const { aiEnabledIn, registerAiSetting } = require('./aiSetting.cjs');
const { registerTutorialSetting } = require('./tutorialSetting.cjs');
const { registerFeedbackSetting, countSession } = require('./feedbackSetting.cjs');
const { installCrashLogging } = require('./crashLog.cjs');

/**
 * Where the app remembers the user's chosen library folder.
 *
 * Kept in its own small file rather than in the renderer's preferences, because the store root
 * has to be known before the server module is even loaded — long before any UI exists to read
 * preferences from.
 */
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

// Unhandled rejections and uncaught exceptions are written to <userData>/crash.log (see crashLog.cjs).
installCrashLogging({ file: path.join(app.getPath('userData'), 'crash.log'), onFatal: () => app.exit(1) });

/** The default library location: per-user and writable on every platform Electron targets. */
const DEFAULT_STORE_DIR = path.join(app.getPath('userData'), 'library');

/**
 * The app's icon, sourced straight from the repo rather than duplicated. A packaged build gets
 * its icon from the OS-level bundle metadata electron-builder writes at build time (see
 * package.json's `build.mac.icon` / `build.win.icon`), so this path is only ever read when it
 * exists — which in practice means only in an unpackaged `npm run desktop` run, where Electron
 * otherwise shows its own generic icon in the Dock and taskbar instead of Marginalia's.
 */
const APP_ICON_PATH = (() => {
  /**
   * The icon this process hands to the OS, per platform.
   *
   * Windows draws its taskbar icon from whatever the BrowserWindow is given, falling back to the
   * executable's embedded one. `build/` was not in electron-builder's `files`, so in a packaged
   * app this path did not exist at all, `icon` came through undefined, and the taskbar was left
   * with whatever the installer had baked in — which is why the icon went missing after an
   * update. `build/icon.*` now ships with the app.
   *
   * The format is NOT interchangeable. Windows wants the .ico, because it carries the small sizes
   * Windows actually draws at; macOS cannot decode one, and handing it to `app.dock.setIcon`
   * throws "Failed to load image from path" during startup and takes the whole app down with it.
   * macOS gets its own `icon-mac.png`, drawn for the Dock; the packaged .app uses `icon.icns`.
   */
  const file = process.platform === 'win32' ? 'icon.ico'
    : process.platform === 'darwin' ? 'icon-mac.png'
      : 'icon.png';
  return path.join(__dirname, '..', 'build', file);
})();

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/** Writes to a temp file and renames it over config.json, so a crash mid-write never leaves a half file. */
function writeConfig(config) {
  const tmpPath = `${CONFIG_PATH}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(config, null, 2), 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, CONFIG_PATH);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // The write error is the one worth reporting; a leftover temp file is swept at next launch.
    }
    throw err;
  }
}

/** Removes temp files a crash left between writing and renaming (`config.json.<pid>.tmp`). */
function removeStaleConfigTemps() {
  const dir = path.dirname(CONFIG_PATH);
  const prefix = `${path.basename(CONFIG_PATH)}.`;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(prefix) && name.endsWith('.tmp')) fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch (err) {
    console.error('[config] could not sweep stale temp files', err);
  }
}

/**
 * Merges `patch` into the stored config and returns whether it was saved.
 *
 * A missing file counts as empty. A file that is not valid JSON is copied to `config.json.bad`
 * and then also treated as empty, so one corrupt file cannot block every later save. Any other
 * read error (EACCES, EIO, ...) skips the write: overwriting from `{}` would drop the storeDir.
 */
function updateConfig(patch) {
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    if (err instanceof SyntaxError) {
      try {
        fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bad`);
      } catch (copyErr) {
        console.error('[config] not updating config.json: it is corrupt and could not be backed up', copyErr);
        return false;
      }
      console.error('[config] config.json was corrupt; kept a copy as config.json.bad', err);
    } else if (err.code !== 'ENOENT') {
      console.error('[config] not updating config.json: it could not be read', err);
      return false;
    }
  }
  try {
    writeConfig({ ...current, ...patch });
    return true;
  } catch (err) {
    console.error('[config] could not save config.json', err);
    return false;
  }
}

/**
 * Saves the library location. On failure tells the user (the library is already in place for
 * this session, but the next launch would open the old folder) and returns an error code.
 */
async function persistStoreDir(dir) {
  if (updateConfig({ storeDir: dir })) return null;
  await dialog.showMessageBox(mainWindow, {
    type: 'error',
    message: 'Marginalia could not remember your storage folder.',
    detail: 'Your documents are in place for now, but the next launch may open the previous folder. ' +
      'Check that the app can write to its settings folder, then choose the folder again.'
  });
  return 'config-save-failed';
}

// The store root must be set before the server module is loaded, because the backend reads it
// when it first resolves.
removeStaleConfigTemps();
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
/** Longest a close or quit waits for the renderer to save what is pending. */
const FLUSH_TIMEOUT_MS = 3000;
/** Set once the quit-time flush has finished, so window closes during the quit do not wait again. */
let quitFlushed = false;
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
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      javascript: true,
      partition: RENDER_PARTITION
    }
  });
  // No navigation, no requests beyond this temp file and data: URIs (see renderGuard.cjs).
  const releaseGuard = guardRenderWindow(win, tmpFile);

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
    releaseGuard();
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
  // The AI opt-in, off unless saved as on (see electron/aiSetting.cjs).
  serverModule.setAiEnabled(aiEnabledIn(readConfig()));
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
    // Windows/Linux taskbar icon in an unpackaged run — see APP_ICON_PATH.
    icon: fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined,
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

  // Pending debounced saves (marks, notes, reading position) are flushed before the window goes.
  // A quit has already flushed by the time it closes windows, so that close skips the wait.
  const win = mainWindow;
  // Then the time-spaced mark backups get their "document closed" checkpoint.
  const closeGuard = createExitGuard(
    () => flushThenCheckpoint(() => requestFlush(win.webContents, ipcMain, FLUSH_TIMEOUT_MS), checkpointMarkBackups),
    () => quitFlushed
  );
  win.on('close', (event) =>
    closeGuard(event, () => {
      if (!win.isDestroyed()) win.close();
    })
  );
  // The renderer may not veto a close or quit (a save that keeps failing would block it forever);
  // pending saves were already flushed over IPC by the guard above.
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
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
    // mailto: only to the app's own feedback address (Send feedback), never any other.
    const feedbackMail = parsed.protocol === 'mailto:' && parsed.pathname.toLowerCase() === 'marginaliaannotator@gmail.com';
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || feedbackMail) {
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

// Moving the library: see migrateLibrary in storage.cjs.

/** Tells the user a library move failed (nothing was switched) and returns the IPC error shape. */
async function reportMigrationFailure(message) {
  await dialog.showMessageBox(mainWindow, {
    type: 'error',
    message: 'Your documents could not be moved.',
    detail: `${message}\n\nNothing was changed: Marginalia is still using the previous folder.`
  });
  return { changed: false, error: 'migration-failed' };
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
      const migration = await tryMigrateLibrary(storeDir, chosen);
      if (!migration.ok) return reportMigrationFailure(migration.message);
      movedCount = migration.moved;
    }
  }

  storeDir = chosen;
  serverModule?.setStoreDirectory(storeDir);
  const saveError = await persistStoreDir(storeDir);

  return { changed: true, path: storeDir, moved: movedCount, ...(saveError && { error: saveError }) };
});

/** Puts the library back in the default per-user location. */
ipcMain.handle('marginalia:reset-storage-dir', async () => {
  if (storeDir === DEFAULT_STORE_DIR) return { changed: false, path: storeDir };
  // A failed copy must not switch folders: the library would open empty and the reader's
  // documents would sit unseen in the old folder. Stay put and say why, like the choose action.
  const migration = await tryMigrateLibrary(storeDir, DEFAULT_STORE_DIR);
  if (!migration.ok) return reportMigrationFailure(migration.message);
  storeDir = DEFAULT_STORE_DIR;
  serverModule?.setStoreDirectory(storeDir);
  const saveError = await persistStoreDir(undefined);
  return { changed: true, path: storeDir, ...(saveError && { error: saveError }) };
});

// ── Mark backups: checkpoint documents whose changes the 10-minute window skipped ──
function checkpointMarkBackups() {
  return serverModule && serverModule.checkpointPendingMarkBackups ? serverModule.checkpointPendingMarkBackups() : null;
}

// ── AI opt-in: config.json `aiEnabled`, off by default ───────────────────────
registerAiSetting({
  ipcMain,
  readConfig,
  updateConfig,
  apply: (on) => serverModule && serverModule.setAiEnabled(on)
});

// ── First-run tutorial: config.json `tutorialSeen` (see electron/tutorialSetting.cjs) ──
registerTutorialSetting({ ipcMain, readConfig, updateConfig });

// ── Occasional feedback prompt: config.json sessionCount / feedbackAnswer (see electron/feedbackSetting.cjs) ──
registerFeedbackSetting({ ipcMain, readConfig, updateConfig });

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
let lastUpdateStatus = null;

function broadcastUpdateStatus(status) {
  lastUpdateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('marginalia:updater-status', status);
  }
}

autoUpdater.autoDownload = true;
// Always fetch the whole package: a differential patch is one more step that can fail mid-update.
autoUpdater.disableDifferentialDownload = true;
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

/**
 * The last status sent, for a subscriber that arrives after it went out (a reloaded or recreated
 * window). The preload asks for it once on subscribe; a push sent before then would be dropped.
 */
ipcMain.handle('marginalia:updater-last-status', () => lastUpdateStatus);

/**
 * The version the reader said "Later" to. Kept in the config file, not localStorage: the embedded
 * server binds a fresh port each launch, and a new port is a new origin with empty storage.
 */
ipcMain.handle('marginalia:updater-get-dismissed', () => readConfig().dismissedUpdateVersion ?? null);

ipcMain.handle('marginalia:updater-set-dismissed', (_event, version) => {
  updateConfig({ dismissedUpdateVersion: typeof version === 'string' ? version.slice(0, 64) : undefined });
});

ipcMain.handle('marginalia:updater-get-preference', () => readConfig().autoUpdateEnabled !== false);

ipcMain.handle('marginalia:updater-set-preference', (_event, enabled) => {
  updateConfig({ autoUpdateEnabled: !!enabled });
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

  // macOS's Dock icon, for an unpackaged run only — see APP_ICON_PATH. A packaged .app takes its
  // Dock icon from `icon.icns` via Info.plist; `build/icon.*` also ships inside it, so without the
  // isPackaged check the flat PNG would replace the icns at runtime.
  if (process.platform === 'darwin' && !app.isPackaged && app.dock && fs.existsSync(APP_ICON_PATH)) {
    app.dock.setIcon(APP_ICON_PATH);
  }

  // The first quit waits (at most FLUSH_TIMEOUT_MS) for pending saves, then quits for real.
  const quitGuard = createExitGuard(() =>
    flushThenCheckpoint(
      () => requestFlush(mainWindow && mainWindow.webContents, ipcMain, FLUSH_TIMEOUT_MS),
      checkpointMarkBackups
    ).finally(() => {
      quitFlushed = true;
    })
  );
  app.on('before-quit', (event) => quitGuard(event, () => app.quit()));

  app.whenReady().then(async () => {
    try {
      countSession({ readConfig, updateConfig });
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
