/**
 * Fresh install, for real: launches the built desktop app (electron/main.cjs) with an empty user
 * data folder of its own (never the reader's), and checks over the DevTools protocol that
 *
 * 1. the first-run tutorial shows on the home page;
 * 2. skipping it is saved to config.json (tutorialSeen: true);
 * 3. the next launch does not show it again.
 *
 *   node scripts/e2e-first-run.cjs      (after npm run build; npm run test:e2e runs it)
 *
 * Exits 0 when every check passes, 1 otherwise, printing each result.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELECTRON = require(path.join(ROOT, 'node_modules', 'electron'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Starts the app; resolves with an evaluate(expression) over CDP and a stop(). */
async function launch(userData, port) {
  const child = spawn(ELECTRON, [ROOT, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
    stdio: 'ignore'
  });
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+/.test(t.url));
    } catch {
      /* not up yet */
    }
  }
  if (!target) {
    child.kill();
    throw new Error('the app window never appeared');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const evaluate = (expression) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, (msg) => resolve(msg.result?.result?.value));
      ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  const stop = async () => {
    ws.close();
    child.kill();
    await sleep(1500);
  };
  return { evaluate, stop };
}

/** Waits up to `ms` for the tutorial dialog; true if it showed. */
async function tutorialShows(evaluate, ms) {
  for (let t = 0; t < ms; t += 250) {
    if (await evaluate(`Boolean(document.querySelector('[aria-labelledby="tutorial-title"]'))`)) return true;
    await sleep(250);
  }
  return false;
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'marginalia-first-run-'));
  try {
    let app = await launch(userData, 9341);
    const shown = await tutorialShows(app.evaluate, 15000);
    check('Fresh install: the tutorial shows on the home page', shown);
    if (shown) await app.evaluate(`document.querySelector('[aria-label="Skip the tour"]').click(), true`);
    await sleep(800);
    await app.stop();
    const config = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
    check('Skipping it is saved in config.json', config.tutorialSeen === true, JSON.stringify({ tutorialSeen: config.tutorialSeen }));

    app = await launch(userData, 9342);
    const again = await tutorialShows(app.evaluate, 6000);
    check('The next launch does not show it again', !again);
    // Send feedback, from the sidebar: a dialog with the email address as selectable text.
    const feedback = await app.evaluate(`(async () => {
      [...document.querySelectorAll('#desktop-sidebar-nav button')].find((b) => b.textContent.includes('Send feedback')).click();
      await new Promise((r) => setTimeout(r, 400));
      const d = document.querySelector('[aria-labelledby="feedback-dialog-title"]');
      const email = d && [...d.querySelectorAll('.select-all')].map((e) => e.textContent).join();
      return { open: Boolean(d), email, form: Boolean(d && [...d.querySelectorAll('button')].some((b) => b.textContent.includes('feedback form'))), google: Boolean(d && d.textContent.includes('hosted by Google')) };
    })()`);
    check('Send feedback opens a dialog with the email as selectable text', Boolean(feedback?.open) && feedback.email === 'marginaliaannotator@gmail.com', JSON.stringify(feedback));
    await app.stop();
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('e2e failed:', err);
  process.exit(1);
});
