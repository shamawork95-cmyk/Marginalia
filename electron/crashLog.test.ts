/**
 * Run with: npx tsx --test electron/crashLog.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const { crashLine, appendCapped, installCrashLogging } = createRequire(import.meta.url)('./crashLog.cjs');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'marginalia-crash-')), 'crash.log');

test('a line carries the time, the kind and the stack', () => {
  const line = crashLine('unhandledRejection', new Error('boom'), new Date('2026-11-12T10:00:00Z'));
  assert.match(line, /^2026-11-12T10:00:00\.000Z unhandledRejection: Error: boom\n/);
  assert.equal(crashLine('x', 'plain', new Date(0)), '1970-01-01T00:00:00.000Z x: plain\n');
});

test('the log is capped, keeping the newest lines whole', () => {
  const file = tmp();
  for (let i = 0; i < 50; i++) appendCapped(file, `line ${i} ${'x'.repeat(30)}\n`, 600);
  const text = fs.readFileSync(file, 'utf-8');
  assert.ok(text.length <= 600);
  assert.match(text, /^line \d+ /);
  assert.match(text, /line 49 x+\n$/);
});

test('both handlers log to the file; an uncaught exception then calls onFatal', () => {
  const file = tmp();
  const proc = new EventEmitter();
  const fatal: unknown[] = [];
  installCrashLogging({ proc, file, onFatal: (e: unknown) => fatal.push(e), log: () => {} });
  proc.emit('unhandledRejection', new Error('rejected'));
  const err = new Error('thrown');
  proc.emit('uncaughtException', err);
  const text = fs.readFileSync(file, 'utf-8');
  assert.match(text, /unhandledRejection: Error: rejected/);
  assert.match(text, /uncaughtException: Error: thrown/);
  assert.deepEqual(fatal, [err]);
});

test('an unwritable log path never throws', () => {
  assert.doesNotThrow(() => appendCapped(path.join(tmp(), 'is-a-file-not-a-dir', 'x.log'), 'x\n'));
});
