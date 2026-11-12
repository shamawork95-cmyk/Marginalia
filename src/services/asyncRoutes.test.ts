/**
 * Run with: npx tsx --test src/services/asyncRoutes.test.ts
 *
 * A route that throws, synchronously or from a rejected promise, answers 500 and the server keeps
 * serving; before, an async rejection was unhandled and could take the server down.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'net';
import express, { Router } from 'express';
import { catchAsyncErrors, jsonErrorHandler } from './asyncRoutes';

let base = '';
let close: () => void = () => {};
const rejections: unknown[] = [];
const onRejection = (r: unknown) => rejections.push(r);

before(async () => {
  process.on('unhandledRejection', onRejection);
  const app = catchAsyncErrors(express());
  const router = catchAsyncErrors(Router());
  app.set('marker', 'kept');
  app.get('/async', async () => {
    throw new Error('async boom');
  });
  app.get('/sync', () => {
    throw new Error('sync boom');
  });
  app.get('/ok', (_req, res) => {
    res.json({ setting: app.get('marker') });
  });
  router.post('/inner', async () => {
    await Promise.reject(new Error('router boom'));
  });
  app.use('/r', router);
  app.use(jsonErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(() => {
  close();
  process.off('unhandledRejection', onRejection);
});

test('async, sync and router errors answer 500 with JSON, and nothing is left unhandled', async () => {
  const errorLog = console.error;
  console.error = () => {};
  try {
    for (const [method, path] of [['GET', '/async'], ['GET', '/sync'], ['POST', '/r/inner']]) {
      const res = await fetch(base + path, { method });
      assert.equal(res.status, 500, path);
      assert.match((await res.json()).error, /Something went wrong/);
    }
  } finally {
    console.error = errorLog;
  }
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rejections.length, 0);
});

test('the server keeps serving afterwards, and app.get(name) still reads a setting', async () => {
  const res = await fetch(`${base}/ok`);
  assert.deepEqual(await res.json(), { setting: 'kept' });
});
