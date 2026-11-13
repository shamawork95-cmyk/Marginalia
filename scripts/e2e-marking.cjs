/**
 * End-to-end checks of selecting text and making marks, in the real app (Electron + the built
 * server), on a throwaway library in the temp folder — never the reader's own.
 *
 *   npm run test:e2e        (builds first)
 *
 * 1. PDF: a selection that starts over the sidebar saves only the page's own words as its quote.
 * 2. PDF: the same words are not marked twice under the same theme; turning on a second theme in
 *    the selection menu and marking them again files the same mark under both, shown with a dot.
 * 3. Text reader: a selection becomes a highlight with its words and the active theme, and
 *    re-marking it under a second theme adds that theme to it.
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

async function samplePdf() {
  const { PDFDocument, StandardFonts } = require(path.join(ROOT, 'node_modules', 'pdf-lib'));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([420, 595]);
  page.drawText('I met a traveller from an antique land', { x: 40, y: 520, size: 14, font });
  page.drawText('Who said: Two vast and trunkless legs of stone', { x: 40, y: 496, size: 14, font });
  return Buffer.from(await doc.save());
}

async function main() {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'marginalia-e2e-'));
  Object.assign(process.env, { MARGINALIA_STORE_DIR: store, MARGINALIA_EMBEDDED: '1', NODE_ENV: 'production', PORT: '0' });
  const server = require(path.join(ROOT, 'dist', 'server.cjs'));
  const port = await server.startServer({ staticRoot: path.join(ROOT, 'dist') });
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, method = 'GET', body) => {
    const res = await fetch(`${base}/api${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return res.json();
  };
  const version = /CURRENT_APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'src', 'data', 'changelog.ts'), 'utf8'))[1];
  await api('/settings', 'PUT', {
    settings: {
      name: 'Reader',
      lastSeenVersion: version,
      activeThemes: [
        { id: 'love', name: 'Love', color: '#b5527a' },
        { id: 'ruin', name: 'Ruin', color: '#3f6fb5' }
      ]
    }
  });
  const pdf = await api('/documents', 'POST', { title: 'Ozymandias', text: 'I met a traveller', format: 'PDF', filename: 'ozymandias.pdf' });
  await fetch(`${base}/api/documents/${pdf.id}/original?filename=ozymandias.pdf`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: await samplePdf() });
  const txt = await api('/documents', 'POST', { title: 'Sonnet', text: 'Look on my works, ye Mighty, and despair!\nNothing beside remains.', format: 'TXT', layout: 'verbatim' });

  const win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true } });
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const open = async (screen, doc, format) => {
    const session = { currentScreen: screen, analysisDoc: { title: doc.title, text: '', format, docId: doc.id }, uploadedLibrary: [], documentNotes: {}, documentFormats: {} };
    await win.loadURL(base);
    await js(`sessionStorage.setItem('marginalia_session', ${JSON.stringify(JSON.stringify(session))}); return true;`);
    await win.loadURL(base);
    await sleep(3500);
  };
  const marksOf = async (id) => (await api(`/documents/${id}/annotations`)).annotations;
  /** Selects from (startSel, offset) to the end of `word` in the text under endSel, as a mouse drag ends. */
  const select = (startSel, endSel, word) => js(`
    const end = document.querySelector(${JSON.stringify(endSel)});
    const walker = document.createTreeWalker(end, NodeFilter.SHOW_TEXT);
    let node; for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.includes(${JSON.stringify(word)})) { node = n; break; }
    if (!node) throw new Error('word not found');
    const r = document.createRange();
    const start = ${startSel ? `document.querySelector(${JSON.stringify(startSel)})` : 'null'};
    if (start) r.setStartBefore(start); else r.setStart(node, node.data.indexOf(${JSON.stringify(word)}));
    r.setEnd(node, node.data.indexOf(${JSON.stringify(word)}) + ${word.length});
    getSelection().removeAllRanges(); getSelection().addRange(r);
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', bubbles: true }));
    // A real mouse release sends both; the PDF workspace listens for mouseup.
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return getSelection().toString().length;
  `);
  const menuButton = (label) => js(`
    await new Promise((r) => setTimeout(r, 400));
    const menu = document.querySelector('[aria-label="Mark the selection"]');
    if (!menu) throw new Error('selection menu did not open');
    const b = [...menu.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').startsWith(${JSON.stringify(label)}));
    if (!b) throw new Error('no menu button ' + ${JSON.stringify(label)});
    b.click(); return true;
  `);

  // 1. PDF selection begun over the sidebar.
  await open('workspace', pdf, 'PDF');
  await select('#desktop-sidebar-nav', '.marginalia-text-layer', 'antique land');
  await menuButton('Highlight');
  await sleep(1500);
  let marks = await marksOf(pdf.id);
  const q = marks[0]?.quote ?? '';
  check('PDF: a selection begun over the sidebar quotes only the page, under the active theme', marks.length === 1 && JSON.stringify(marks[0].themeIds) === '["love"]' && q.endsWith('antique land') && !/SEARCH|Marginalia|COLLECTIONS|THEME/.test(q), JSON.stringify(q));

  // 2. Same words: again under the same theme (refused), then with a second theme on (added to the mark).
  await select(null, '.marginalia-text-layer', 'trunkless legs');
  await menuButton('Highlight');
  await sleep(1200);
  const afterFirst = (await marksOf(pdf.id)).length;
  await select(null, '.marginalia-text-layer', 'trunkless legs');
  await menuButton('Highlight');
  await sleep(1200);
  check('PDF: the same words are not marked twice under the same theme', (await marksOf(pdf.id)).length === afterFirst);
  await select(null, '.marginalia-text-layer', 'trunkless legs');
  await menuButton('Theme: Ruin');
  await menuButton('Highlight');
  await sleep(1500);
  marks = await marksOf(pdf.id);
  const legs = marks.filter((m) => (m.quote || '').endsWith('trunkless legs'));
  check('PDF: marking the same words with a second theme on files the one mark under both', legs.length === 1 && JSON.stringify(legs[0].themeIds) === '["love","ruin"]', JSON.stringify(legs.map((m) => m.themeIds)));
  // On disk the older single themeId is kept too (the main theme), for older versions of the app.
  const disk = JSON.parse(fs.readFileSync(path.join(store, 'documents', `${pdf.id}.json`), 'utf8')).annotations.find((m) => m.id === legs[0]?.id);
  check('PDF: on disk the mark also keeps its main theme as themeId, for older versions', disk?.themeId === 'love' && JSON.stringify(disk?.themeIds) === '["love","ruin"]', JSON.stringify(disk && { themeId: disk.themeId, themeIds: disk.themeIds }));
  const dots = await js(`return document.querySelectorAll('[aria-label="Also filed under Ruin"]').length;`);
  check('PDF: a mark under two themes shows a dot for its second theme', dots === 1, String(dots));

  // 3. Text reader.
  await open('reader', txt, 'TXT');
  await select(null, '#reader-para-text-0', 'Mighty');
  await menuButton('Highlight');
  await sleep(1500);
  const tm = await marksOf(txt.id);
  check('Reader: a selection becomes a highlight with its words and theme', tm.length === 1 && tm[0].quote === 'Mighty' && JSON.stringify(tm[0].themeIds) === '["love"]' && tm[0].kind === 'highlight', JSON.stringify(tm[0] && { quote: tm[0].quote, themeIds: tm[0].themeIds }));
  await select(null, '#reader-para-text-0', 'Mighty');
  await menuButton('Theme: Ruin');
  await menuButton('Highlight');
  await sleep(1500);
  const tm2 = await marksOf(txt.id);
  const readerDots = await js(`return document.querySelectorAll('#reader-para-text-0 [aria-label="Also filed under Ruin"]').length;`);
  check('Reader: re-marking under a second theme adds it to the same mark, with a dot', tm2.length === 1 && JSON.stringify(tm2[0].themeIds) === '["love","ruin"]' && readerDots === 1, JSON.stringify({ themeIds: tm2.map((m) => m.themeIds), readerDots }));

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
