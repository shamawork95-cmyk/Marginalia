/**
 * Logs what would otherwise vanish: an unhandled promise rejection or an uncaught exception in the
 * main process (or the embedded server, which runs in it). Each goes to the console and to
 * `crash.log` in the app's data folder, so a reader's "it just stopped" can be traced afterwards.
 *
 * Logging only. An uncaught exception still ends the app the way Electron would have (after the
 * line is written): carrying on in an unknown state risks the reader's saves.
 */

const fs = require('fs');
const path = require('path');

/** Past this the log is started afresh, keeping the newest half. */
const MAX_BYTES = 512 * 1024;

/** One log line: ISO time, kind, and the error's stack (or its text). */
function crashLine(kind, err, now = new Date()) {
  const detail = err && err.stack ? err.stack : String(err);
  return `${now.toISOString()} ${kind}: ${detail}\n`;
}

/** Appends `line` to `file`, trimming the file to its newer half once it passes MAX_BYTES. */
function appendCapped(file, line, max = MAX_BYTES) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size + line.length > max) {
      const kept = fs.readFileSync(file, 'utf-8').slice(-Math.floor(max / 2));
      fs.writeFileSync(file, kept.slice(kept.indexOf('\n') + 1));
    }
    fs.appendFileSync(file, line);
  } catch {
    // A log that cannot be written must never become a second failure.
  }
}

/** Registers the two handlers on `proc`. `onFatal` runs after an uncaught exception is logged. */
function installCrashLogging({ proc = process, file, onFatal = () => proc.exit(1), log = console.error }) {
  proc.on('unhandledRejection', (reason) => {
    const line = crashLine('unhandledRejection', reason);
    log(`[Marginalia] ${line.trim()}`);
    appendCapped(file, line);
  });
  proc.on('uncaughtException', (err) => {
    const line = crashLine('uncaughtException', err);
    log(`[Marginalia] ${line.trim()}`);
    appendCapped(file, line);
    onFatal(err);
  });
}

module.exports = { crashLine, appendCapped, installCrashLogging, MAX_BYTES };
