/**
 * End-to-end checks of page turns and views in the PDF workspace, in the real app (Electron + the
 * built server), on a throwaway library in the temp folder — never the reader's own.
 *
 *   npm run test:e2e        (builds first, then runs this after e2e-marking.cjs)
 *
 * 1. Book view: a page turn's overlay is gone within about 800 ms, and the new pages are painted.
 * 2. Six pages in view: clicking a page opens it at reading size, one page in view.
 * 3. Fit page: the whole page fits the window, width and height.
 * 4. A book saved at a big zoom opens fitted to a small window.
 * Exits 0 when every check passes, 1 otherwise, printing each result.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function samplePdf(pages) {
  const { PDFDocument, StandardFonts } = require(path.join(ROOT, 'node_modules', 'pdf-lib'));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([420, 595]);
    page.drawText(`Page ${i}: the lone and level sands stretch far away`, { x: 40, y: 520, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

async function main() {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'marginalia-e2e-views-'));
  Object.assign(process.env, { MARGINALIA_STORE_DIR: store, MARGINALIA_EMBEDDED: '1', NODE_ENV: 'production', PORT: '0' });
  const server = require(path.join(ROOT, 'dist', 'server.cjs'));
  const port = await server.startServer({ staticRoot: path.join(ROOT, 'dist') });
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, method = 'GET', body) => {
    const res = await fetch(`${base}/api${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return res.json();
  };
  const version = /CURRENT_APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'src', 'data', 'changelog.ts'), 'utf8'))[1];
  await api('/settings', 'PUT', { settings: { name: 'Reader', lastSeenVersion: version, activeThemes: [{ id: 'love', name: 'Love', color: '#b5527a' }] } });
  const pdf = await api('/documents', 'POST', { title: 'Sands', text: 'Page 1', format: 'PDF', filename: 'sands.pdf' });
  await fetch(`${base}/api/documents/${pdf.id}/original?filename=sands.pdf`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: await samplePdf(8) });

  const win = new BrowserWindow({ width: 1366, height: 768, show: false, webPreferences: { offscreen: true } });
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const open = async () => {
    const session = { currentScreen: 'workspace', analysisDoc: { title: pdf.title, text: '', format: 'PDF', docId: pdf.id }, uploadedLibrary: [], documentNotes: {}, documentFormats: {} };
    await win.loadURL(base);
    await js(`sessionStorage.setItem('marginalia_session', ${JSON.stringify(JSON.stringify(session))}); return true;`);
    await win.loadURL(base);
    await sleep(3500);
  };
  /** Clicks a toolbar button by its label's start; on a narrower window it sits in the More menu. */
  const press = (label, role = '') =>
    js(`
      const find = () => [...document.querySelectorAll('button${role ? `[role="${role}"]` : ''}')].find((x) => (x.getAttribute('aria-label') || '').startsWith(${JSON.stringify(label)}));
      let b = find();
      if (!b) {
        document.querySelector('[aria-label^="More:"]')?.click();
        await new Promise((r) => setTimeout(r, 300));
        b = find();
      }
      if (!b) throw new Error('no button ' + ${JSON.stringify(label)});
      b.click();
      await new Promise((r) => setTimeout(r, 150));
      // Closed the way a click elsewhere closes it.
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return true;
    `);
  const view = (label) => press(label, 'radio');

  await open();

  // 1. Book view and a turn.
  await view('2 pages');
  await sleep(2500);
  /** Presses → and times the turn overlay from when it appears to when it is gone. */
  const timeTurn = () =>
    js(`
    const t0 = performance.now();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    let started = 0;
    while (performance.now() - t0 < 6000) {
      await new Promise((r) => setTimeout(r, 20));
      const overlay = document.querySelector('.page-turn');
      if (overlay && !started) started = performance.now();
      if (started && !overlay) break;
    }
    const gone = performance.now();
    const shown = [...document.querySelectorAll('.spread-book [data-page-number]:not([data-offstage])')];
    return { overlayMs: started ? Math.round(gone - started) : -1, pages: shown.map((p) => p.dataset.pageNumber), painted: shown.every((p) => p.dataset.painted) };
  `);
  const turn = await timeTurn();
  check('Book: the turn overlay is gone within about 800 ms', turn.overlayMs >= 0 && turn.overlayMs <= 900, `${turn.overlayMs} ms`);
  check('Book: the turn lands on pages 3–4, already painted', turn.pages.join() === '3,4' && turn.painted, JSON.stringify(turn));

  // The same on a CPU slowed 4× (where the overlay used to stay about 3.5 s).
  await sleep(1500);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slow = await timeTurn();
  await win.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate: 1 });
  win.webContents.debugger.detach();
  check('Book, CPU slowed 4×: the overlay is still gone within about a second', slow.overlayMs >= 0 && slow.overlayMs <= 1100 && slow.pages.join() === '5,6', JSON.stringify(slow));
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); return true;`);
  await sleep(1500);

  // 2. Six pages, then a click opens one at reading size.
  await view('6 pages');
  await sleep(2000);
  const grid = await js(`return document.querySelectorAll('button[aria-label^="Open page "]').length;`);
  check('Six pages: every page in the grid is a button to open it', grid === 8, String(grid));
  await js(`document.querySelector('button[aria-label="Open page 5 at reading size"]').click(); return true;`);
  await sleep(1500);
  const opened = await js(`
    const pageWord = document.querySelector('[data-page-number="5"]');
    const area = document.querySelector('[data-page-number="5"]').closest('.overflow-auto, .overflow-y-auto') || document.scrollingElement;
    const r = document.querySelector('[data-page-number="5"]').getBoundingClientRect();
    const a = area.getBoundingClientRect();
    return { single: !document.querySelector('.spread-book') && !pageWord.closest('.grid'), top: Math.round(r.top - a.top), width: Math.round(r.width), areaWidth: Math.round(a.width) };
  `);
  check('Six pages: clicking page 5 opens it at reading size, at the top of the window', opened.single && Math.abs(opened.top) < 60 && opened.width > opened.areaWidth * 0.8, JSON.stringify(opened));

  // 3. Fit page.
  await press('Fit page');
  await sleep(1200);
  const fit = await js(`
    const p = document.querySelector('[data-page-number="5"]').getBoundingClientRect();
    const a = (document.querySelector('[data-page-number="5"]').closest('.overflow-auto, .overflow-y-auto') || document.scrollingElement).getBoundingClientRect();
    return { pageH: Math.round(p.height), areaH: Math.round(a.height), pageW: Math.round(p.width), areaW: Math.round(a.width) };
  `);
  check('Fit page: the whole page fits the window', fit.pageH <= fit.areaH && fit.pageW <= fit.areaW && fit.pageH > fit.areaH * 0.7, JSON.stringify(fit));

  // 4. A book saved at 300% opens fitted to this window.
  await api(`/documents/${pdf.id}/reading-state`, 'PUT', { readingState: { scale: 3, page: 1, viewMode: 'spread' } });
  await js(`localStorage.clear(); return true;`);
  await open();
  await sleep(1500);
  const book = await js(`
    const b = document.querySelector('.spread-book');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, sidebarRight: Math.round(document.querySelector('#desktop-sidebar-nav')?.getBoundingClientRect().right ?? 0) };
  `);
  check('A book saved at a big zoom opens inside a small window, clear of the sidebar', Boolean(book) && book.left >= book.sidebarRight && book.right <= book.vw && book.bottom <= book.vh, JSON.stringify(book));

  win.destroy();
  fs.rmSync(store, { recursive: true, force: true });
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
  app.exit(failed ? 1 : 0);
}

app.disableHardwareAcceleration();
app.whenReady().then(main).catch((err) => {
  console.error('e2e failed:', err);
  app.exit(1);
});
