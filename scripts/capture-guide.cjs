/**
 * Makes the screenshots for "Getting the most from Marginalia" (src/data/guide.ts), from the real
 * app, so the guide shows exactly what a reader sees.
 *
 *   npm run guide:capture        (builds first; writes src/assets/guide/<id>.jpg)
 *
 * It starts the built server on a throwaway library in the temp folder (never the reader's own),
 * fills it with sample documents and marks, opens the app in an offscreen window at 1280×800 and
 * walks it screen by screen. Run it again after changing anything the guide shows.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'src', 'assets', 'guide');
const WIDTH = 1280;
const HEIGHT = 800;
/** Saved width: sharp on the guide's two-column grid, small enough to ship in the app. */
const SAVE_WIDTH = 960;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Sample library ──────────────────────────────────────────────────────────

const GHAZAL = [
  'ہزاروں خواہشیں ایسی کہ ہر خواہش پہ دم نکلے\nبہت نکلے مرے ارمان لیکن پھر بھی کم نکلے',
  'ڈرے کیوں میرا قاتل کیا رہے گا اس کی گردن پر\nوہ خوں جو چشم تر سے عمر بھر یوں دم بہ دم نکلے',
  'نکلنا خلد سے آدم کا سنتے آئے ہیں لیکن\nبہت بے آبرو ہو کر ترے کوچے سے ہم نکلے'
].join('\n\n');

const NIGHT = [
  'The stars come out at night\nThe sea is grey by day\nThe lamp gives off its light\nAnd sorrow fades away',
  'The moon is up, the moon is high\nAnd silver runs along the sky\nThe garden keeps the evening rain\nAnd every leaf is lit again',
  'I kept the letter by the door\nI read it twice and then once more\nThe moon came in across the floor\nAnd asked me nothing, as before'
].join('\n\n');

const ESSAY = [
  'Reading slowly is a way of keeping company with a book. The pencil in the margin is not a tool for taking the text apart but a way of answering it, line by line, the way one answers a letter.',
  'Every reader has a private index. A word underlined in one chapter returns, changed, three hundred pages later, and the second underline only makes sense because of the first. The margin is where that index is written.',
  'Old commonplace books were built this way. A reader copied out a sentence, wrote the author and the page beside it, and filed it under a heading: Time, Memory, the Sea. Years later the headings had become an argument of their own.',
  'Themes are not labels stuck on afterwards. They are the shape a reading takes when the same image keeps arriving: the moon over water, the closed door, the letter read twice. Marking them is how a reader notices the pattern before naming it.',
  'A note in the margin should sit beside the line it answers. Pushed to the end of the chapter it becomes a footnote; kept level with its words it stays part of the conversation.',
  'The best marks are small. A single word circled, a question mark, a line drawn under half a sentence. They are reminders, not essays, and they are written for the reader who comes back.',
  'Coming back is the point. A book read once is a visit; a book read with a pencil is a place one can return to, finding the earlier reader still there, waiting at the edge of the page.',
  'Two readings rarely agree. The second notices what the first rushed past, and quarrels with what the first was sure of. Both belong in the margin, one under the other, dated.',
  'Some readers keep a separate notebook. Others write only in the book. Either way the habit is the same: to slow down, to answer back, and to keep the answer where it can be found.',
  'In the end a well-marked book is a map of attention. It shows where the reader stopped, what made them stop, and which roads they meant to walk again.'
].join('\n\n');

const THEMES = [
  { id: '1', name: 'Key Concepts', color: '#4f8f7a' },
  { id: '2', name: 'Questions', color: '#6d6ad8' },
  { id: '3', name: 'Metaphors', color: '#d97a2b' },
  { id: '4', name: 'Night', color: '#3f6fb5' },
  { id: '5', name: 'Memory', color: '#b5527a' }
];

const now = new Date().toISOString();
const tm = (id, p, start, end, quote, extra = {}) => ({
  id,
  kind: 'highlight',
  anchor: { paragraphIndex: p, start, end },
  themeId: null,
  quote,
  author: 'Reader',
  createdAt: now,
  updatedAt: now,
  ...extra
});
const at = (text, word, from = 0) => {
  const start = text.indexOf(word, from);
  return [start, start + word.length];
};

function nightMarks() {
  const p = NIGHT.split('\n\n');
  const [m0s, m0e] = at(p[1], 'The moon is up');
  const [s0, s1] = at(p[0], 'stars come out');
  const [l0, l1] = at(p[0], 'gives off its light');
  const [d0, d1] = at(p[2], 'The moon came in across the floor');
  const [r0, r1] = at(p[2], 'I read it twice');
  return [
    tm('n1', 0, s0, s1, 'stars come out', { themeId: '4', color: '#3f6fb5', board: { x: 24, y: 24 } }),
    // One passage, two themes: drawn in the first, with a dot for the second.
    tm('n2', 1, m0s, m0e, 'The moon is up', { themeIds: ['4', '3'], color: '#3f6fb5', links: ['n4'], board: { x: 280, y: 160 } }),
    tm('n4', 2, d0, d1, 'The moon came in across the floor', { themeId: '5', color: '#b5527a', links: ['n2'], board: { x: 40, y: 300 } }),
    tm('n5', 2, r0, r1, 'I read it twice', {
      kind: 'note',
      themeId: '5',
      color: '#b5527a',
      title: 'Rereading',
      text: 'The letter is read the way this poem asks to be read: twice, then once more.'
    }),
    tm('n6', 0, l0, l1, 'gives off its light', { kind: 'underline', themeId: '1', color: '#4f8f7a' })
  ];
}

function essayMarks() {
  const p = ESSAY.split('\n\n');
  const [a0, a1] = at(p[1], 'private index');
  const [b0, b1] = at(p[2], 'commonplace books');
  const [c0, c1] = at(p[3], 'the moon over water');
  const [d0, d1] = at(p[4], 'sit beside the line it answers');
  return [
    tm('e1', 1, a0, a1, 'private index', { themeId: '1', color: '#4f8f7a' }),
    tm('e2', 2, b0, b1, 'commonplace books', { themeId: '1', color: '#4f8f7a', isTerminology: true }),
    tm('e3', 3, c0, c1, 'the moon over water', { themeId: '3', color: '#d97a2b' }),
    tm('e4', 4, d0, d1, 'sit beside the line it answers', {
      kind: 'note',
      themeId: '2',
      color: '#6d6ad8',
      title: 'Where notes belong',
      text: 'Level with the words, not at the end of the chapter.'
    })
  ];
}

async function samplePdf() {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const paras = ESSAY.split('\n\n');
  for (let n = 0; n < 8; n++) {
    const page = doc.addPage([420, 595]);
    page.drawText(`On Marginalia — ${n + 1}`, { x: 40, y: 545, size: 15, font: bold, color: rgb(0.15, 0.15, 0.15) });
    let y = 510;
    for (const para of [paras[n % paras.length], paras[(n + 3) % paras.length]]) {
      const words = para.split(' ');
      let line = '';
      for (const w of words) {
        if (font.widthOfTextAtSize(`${line} ${w}`, 11.5) > 340) {
          page.drawText(line, { x: 40, y, size: 11.5, font });
          y -= 17;
          line = w;
        } else line = line ? `${line} ${w}` : w;
      }
      page.drawText(line, { x: 40, y, size: 11.5, font });
      y -= 30;
    }
  }
  return Buffer.from(await doc.save());
}

function pdfMarks() {
  const base = { themeId: null, author: 'Reader', createdAt: now };
  return [
    { ...base, id: 'p1', page: 1, kind: 'highlight', color: '#4f8f7a', themeId: '1', rects: [{ x: 0.093, y: 0.122, w: 0.79, h: 0.028 }], quote: 'Reading slowly is a way of keeping company' },
    { ...base, id: 'p2', page: 1, kind: 'ink', color: '#d97a2b', weight: 0.004, points: [{ x: 0.1, y: 0.42 }, { x: 0.3, y: 0.4 }, { x: 0.5, y: 0.43 }, { x: 0.7, y: 0.41 }] },
    { ...base, id: 'p3', page: 1, kind: 'rect', color: '#3f6fb5', weight: 0.004, box: { x: 0.08, y: 0.47, w: 0.84, h: 0.13 } },
    { ...base, id: 'p4', page: 1, kind: 'rect', color: '#000000', weight: 0, filled: true, box: { x: 0.095, y: 0.66, w: 0.5, h: 0.032 } },
    { ...base, id: 'p5', page: 1, kind: 'arrow', color: '#b5527a', weight: 0.004, from: { x: 0.85, y: 0.78 }, to: { x: 0.7, y: 0.7 } },
    { ...base, id: 'p6', page: 1, kind: 'note', color: '#6d6ad8', themeId: '2', box: { x: 0.62, y: 0.8, w: 0.3, h: 0.12 }, text: 'Compare the closing image with page 4.', noteStyle: 'translucent' }
  ];
}

// ── Driving the window ──────────────────────────────────────────────────────

/** Helpers defined in the page after each load. */
const PAGE_HELPERS = `
  window.__q = (sel, text) => {
    const els = [...document.querySelectorAll(sel)];
    const el = text === undefined ? els[0] : els.find((e) =>
      (e.getAttribute('aria-label') || '').includes(text) || (e.title || '').includes(text) || e.textContent.trim() === text || e.textContent.includes(text));
    if (!el) throw new Error('not found: ' + sel + ' ' + (text || ''));
    return el;
  };
  window.__click = (sel, text) => { window.__q(sel, text).click(); return true; };
  // A PDF view button, from the toolbar row or, on a narrow window, from its "More" menu.
  window.__view = async (label) => {
    const inline = [...document.querySelectorAll('button[role="radio"]')].find((b) => (b.getAttribute('aria-label') || '').includes(label));
    if (inline) return inline.click(), true;
    document.querySelector('[aria-label^="More:"]').click();
    await new Promise((r) => setTimeout(r, 300));
    window.__click('button[role="radio"]', label);
    // Closed the way a click elsewhere closes it, so the picture is not covered.
    await new Promise((r) => setTimeout(r, 200));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return true;
  };
  window.__type = (sel, value) => {
    const el = window.__q(sel);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  window.__rect = (sel, text, pad = 12) => {
    const r = window.__q(sel, text).getBoundingClientRect();
    return { x: Math.max(0, Math.floor(r.left - pad)), y: Math.max(0, Math.floor(r.top - pad)), width: Math.ceil(r.width + 2 * pad), height: Math.ceil(r.height + 2 * pad) };
  };
  window.__select = (paraIdx, word) => {
    const p = document.getElementById('reader-para-text-' + paraIdx);
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.data.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + word.length);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', bubbles: true }));
      return true;
    }
    throw new Error('word not found: ' + word);
  };
  true;
`;

async function main() {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'marginalia-guide-'));
  process.env.MARGINALIA_STORE_DIR = store;
  process.env.MARGINALIA_EMBEDDED = '1';
  process.env.NODE_ENV = 'production';
  process.env.PORT = '0';
  const server = require(path.join(DIST, 'server.cjs'));
  const port = await server.startServer({ staticRoot: DIST });
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, method = 'GET', body) => {
    const res = await fetch(`${base}/api${p}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`${method} ${p}: ${res.status}`);
    return res.json();
  };
  const version = /CURRENT_APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'src', 'data', 'changelog.ts'), 'utf8'))[1];

  // Documents, oldest first so the shelf reads in a sensible order.
  const essay = await api('/documents', 'POST', { title: 'On Marginalia', text: ESSAY, format: 'TXT', layout: 'verbatim' });
  const night = await api('/documents', 'POST', { title: 'Night Songs', text: NIGHT, format: 'TXT', layout: 'verbatim' });
  const ghazal = await api('/documents', 'POST', { title: 'Ghalib: Hazaron khwahishen', text: GHAZAL, format: 'TXT', layout: 'verbatim' });
  const pdf = await api('/documents', 'POST', { title: 'Reading Slowly', text: ESSAY, format: 'PDF', filename: 'reading-slowly.pdf' });
  await fetch(`${base}/api/documents/${pdf.id}/original?filename=reading-slowly.pdf`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await samplePdf()
  });
  await api(`/documents/${essay.id}/annotations`, 'PUT', { annotations: essayMarks() });
  await api(`/documents/${night.id}/annotations`, 'PUT', { annotations: nightMarks() });
  await api(`/documents/${pdf.id}/annotations`, 'PUT', { annotations: pdfMarks() });
  for (const [id, position, total] of [[essay.id, 6, 10], [night.id, 3, 3], [ghazal.id, 2, 3], [pdf.id, 3, 8]]) {
    await api(`/documents/${id}/progress`, 'PUT', { position, total }).catch(() => {});
  }
  const settings = {
    name: 'Reader',
    typography: 'Literata (Default)',
    fontSize: 18,
    darkMode: false,
    readerMode: false,
    activeThemes: THEMES,
    terminologyColor: '#c08a2e',
    lastSeenVersion: version,
    poetry: {
      [ghazal.id]: { on: true, numbering: 'couplets', prosody: true, metre: 'hazaj musamman saalim' },
      [night.id]: { on: true, numbering: 'lines', prosody: false }
    },
    motifs: [{ id: 'mo-moon', name: 'The moon', terms: ['moon', 'چاند'] }]
  };
  await api('/settings', 'PUT', { settings });

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true }
  });
  win.webContents.setFrameRate(30);
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const helpers = () => win.webContents.executeJavaScript(PAGE_HELPERS);

  /** Opens a screen (and a document) the way a reload of the app would restore it. */
  const open = async (screen, doc) => {
    const session = {
      currentScreen: screen,
      analysisDoc: doc ? { title: doc.title, text: '', format: doc.format, docId: doc.id } : { title: '', text: '' },
      uploadedLibrary: [],
      documentNotes: {},
      documentFormats: {}
    };
    await win.loadURL(base);
    await js(`sessionStorage.setItem('marginalia_session', ${JSON.stringify(JSON.stringify(session))}); return true;`);
    await win.loadURL(base);
    await sleep(2200);
    await helpers();
  };

  fs.mkdirSync(OUT, { recursive: true });
  const made = [];
  const shot = async (id, rect) => {
    await sleep(500);
    const img = await win.webContents.capturePage(rect);
    const size = img.getSize();
    const out = size.width > SAVE_WIDTH ? img.resize({ width: SAVE_WIDTH, quality: 'best' }) : img;
    fs.writeFileSync(path.join(OUT, `${id}.jpg`), out.toJPEG(82));
    made.push(id);
    console.log(`[guide] ${id}.jpg ${size.width}x${size.height}`);
  };
  const step = async (id, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[guide] ${id} failed:`, err && err.message ? err.message : err);
    }
  };
  const full = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
  const rectOf = (sel, text, pad) => js(`return __rect(${JSON.stringify(sel)}, ${JSON.stringify(text)}, ${pad ?? 12});`);

  // Reading
  await step('shelf', async () => {
    await open('home');
    await shot('shelf', full);
  });
  await step('tracker', async () => {
    await js(`document.querySelector('[aria-label="My Margins Tracker views"]').closest('section').scrollIntoView({ block: 'start' }); return true;`);
    await sleep(600);
    await shot('tracker', full);
  });
  await step('reader', async () => {
    await open('reader', essay);
    await shot('reader', full);
  });
  await step('tagging', async () => {
    await shot('tagging', { x: 0, y: 0, width: WIDTH, height: 150 });
  });
  await step('popover', async () => {
    await js(`__select(0, 'The pencil in the margin'); return true;`);
    await sleep(700);
    await shot('popover', full);
    await js(`getSelection().removeAllRanges(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;`);
  });
  await step('find', async () => {
    await js(`__click('button', 'Find in document'); return true;`);
    await sleep(400);
    await js(`__type('input[type="search"], input[aria-label*="Find"]', 'reader'); return true;`);
    await sleep(800);
    await shot('find', full);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;`);
  });
  await step('export', async () => {
    await js(`__click('#reader-bar-export-btn'); return true;`);
    await sleep(800);
    await shot('export', full);
  });
  await step('spread', async () => {
    await open('reader', essay);
    await js(`__click('button[aria-label="Two-page spread"]'); return true;`);
    await sleep(1600);
    await shot('spread', full);
    await js(`__click('button[aria-label="Two-page spread"]'); return true;`);
    await sleep(600);
  });
  await step('margin', async () => {
    await open('reader', night);
    // Down to the last stanza, where the note sits beside its line.
    await js(`document.getElementById('reader-para-2').scrollIntoView({ block: 'center' }); return true;`);
    await sleep(700);
    await shot('margin', full);
  });
  await step('overlap', async () => {
    const r = await rectOf('#reader-para-1', undefined, 16);
    await shot('overlap', { x: r.x, y: r.y, width: Math.min(WIDTH - r.x, r.width + 300), height: r.height });
  });
  await step('board', async () => {
    await js(`__click('button', 'Excerpt board'); return true;`);
    await sleep(900);
    await js(`window.scrollTo(0, 0); return true;`);
    await sleep(300);
    await shot('board', full);
  });
  await step('poetry', async () => {
    await open('reader', ghazal);
    await sleep(800);
    await shot('poetry', full);
  });

  // PDF
  await step('pdftools', async () => {
    await open('workspace', { ...pdf, format: 'PDF' });
    await sleep(1500);
    // Two pages fit the window's height, so all of page one's marks are in view.
    await js(`await __view('2 pages, as a book'); return true;`);
    await sleep(2500);
    await shot('pdftools', full);
  });
  await step('pdfgrid', async () => {
    await js(`await __view('6 pages (3×2)'); return true;`);
    await sleep(3500);
    await shot('pdfgrid', full);
    await js(`await __view('1 page'); return true;`);
    await sleep(600);
  });

  // Finding across the library
  await step('search', async () => {
    await open('home');
    await js(`__click('#desktop-sidebar-nav button', 'Search'); return true;`);
    await sleep(500);
    await js(`__type('[role="dialog"] input', 'moon'); return true;`);
    await sleep(1500);
    await shot('search', full);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;`);
  });
  await step('motif', async () => {
    await open('home');
    await js(`__click('button', 'Trace a motif'); return true;`);
    await sleep(700);
    await js(`__click('button', 'The moon'); return true;`);
    await sleep(1600);
    await shot('motif', full);
  });

  // Settings and Add Document
  await step('thememanager', async () => {
    await open('settings');
    await js(`const h = [...document.querySelectorAll('h2, h3, span')].find((e) => /themes/i.test(e.textContent) && e.closest('section, div')); (h.closest('section') || h.parentElement).scrollIntoView({ block: 'start' }); window.scrollBy(0, -24); return true;`);
    await sleep(600);
    await shot('thememanager', full);
  });
  await step('classpack', async () => {
    await open('upload');
    await js(`document.getElementById('class-pack-heading').scrollIntoView({ block: 'center' }); return true;`);
    await sleep(500);
    await shot('classpack', full);
  });

  console.log(`[guide] made ${made.length} pictures in ${path.relative(ROOT, OUT)}`);
  win.destroy();
  fs.rmSync(store, { recursive: true, force: true });
  app.exit(0);
}

app.disableHardwareAcceleration();
app.whenReady().then(main).catch((err) => {
  console.error('[guide] failed:', err);
  app.exit(1);
});
