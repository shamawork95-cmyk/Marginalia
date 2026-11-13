/**
 * Run with: npx tsx --test src/services/storage/markBackups.test.ts
 *
 * Rotating mark backups, time-spaced: a successful annotations save that changes the marks keeps
 * the set it replaced in `backups/{id}/` only when the newest backup is over 10 minutes old; a
 * checkpoint (document closed/left, app quit) keeps the live set if it changed since then. At most
 * 5, written atomically, never for a failed save, never empty or unchanged sets. Restoring one
 * makes the current set a backup first, so a restore can itself be undone.
 * Every test works on its own temp store; the real library is never touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsDefault from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalDocumentBackend } from './localBackend';
import type { StoredAnnotation } from './types';

async function tempStore(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-backups-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const clock = { ms: 1_800_000_000_000 };
  const backend = new LocalDocumentBackend(root, () => clock.ms);
  const meta = await backend.saveDocument({ title: 'Book', text: 'Some text', format: 'PDF', filename: 'book.pdf' });
  return { root, backend, clock, id: meta.id, dir: path.join(root, 'backups', meta.id) };
}

const MIN = 60_000;
const marks = (n: number, tag = 'm'): StoredAnnotation[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, page: 1 }) as StoredAnnotation);

test('a marks save keeps the set it replaced; listed newest first with time and mark count', async (t) => {
  const { backend, clock, id } = await tempStore(t);
  await backend.updateDocument(id, { annotations: marks(1) });
  await backend.updateDocument(id, { annotations: marks(2) });
  clock.ms += 11 * MIN;
  await backend.updateDocument(id, { annotations: marks(3) });
  const list = await backend.listMarkBackups(id);
  assert.deepEqual(list.map((b) => b.markCount), [2, 1]);
  assert.ok(list.every((b) => !Number.isNaN(Date.parse(b.savedAt)) && /^\d+$/.test(b.id)));
  assert.ok(Date.parse(list[0].savedAt) >= Date.parse(list[1].savedAt));
});

test('never more than 5 backups on disk', async (t) => {
  const { backend, clock, id, dir } = await tempStore(t);
  for (let n = 1; n <= 9; n++) {
    await backend.updateDocument(id, { annotations: marks(n) });
    clock.ms += 11 * MIN;
  }
  const files = await fs.readdir(dir);
  assert.equal(files.length, 5);
  assert.deepEqual((await backend.listMarkBackups(id)).map((b) => b.markCount), [8, 7, 6, 5, 4]);
});

test('a save that leaves the marks as they were, or a title/reading-state change, makes no backup', async (t) => {
  const { backend, id } = await tempStore(t);
  await backend.updateDocument(id, { annotations: marks(2) });
  await backend.updateDocument(id, { annotations: marks(2) });
  await backend.updateDocument(id, { title: 'Renamed' });
  await backend.updateDocument(id, { readingState: { scale: 1, page: 2, viewMode: 'single' } });
  assert.deepEqual(await backend.listMarkBackups(id), []);
});

test('a failed save writes no backup', async (t) => {
  const { backend, id, dir } = await tempStore(t);
  await backend.updateDocument(id, { annotations: marks(1) });
  const real = fsDefault.rename;
  t.mock.method(fsDefault, 'rename', async (from: string, to: string) => {
    if (to.endsWith(`${id}.json`)) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return real(from, to);
  });
  await assert.rejects(backend.updateDocument(id, { annotations: marks(2) }));
  t.mock.restoreAll();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  assert.deepEqual(files, []);
  assert.equal((await backend.getDocument(id))!.annotations.length, 1);
});

test('backups are written atomically: no temp files left beside them', async (t) => {
  const { backend, clock, id, dir } = await tempStore(t);
  for (let n = 1; n <= 3; n++) {
    await backend.updateDocument(id, { annotations: marks(n) });
    clock.ms += 11 * MIN;
  }
  assert.ok((await fs.readdir(dir)).every((f) => /^\d+\.json$/.test(f)));
});

test('restore puts a backup back and keeps the current set as a backup, so restore is undoable', async (t) => {
  const { backend, id } = await tempStore(t);
  await backend.updateDocument(id, { annotations: marks(4, 'a') });
  await backend.updateDocument(id, { annotations: marks(1, 'b') });
  const [older] = await backend.listMarkBackups(id);
  assert.equal(older.markCount, 4);

  const restored = await backend.restoreMarkBackup(id, older.id);
  assert.equal(restored!.annotationCount, 4);
  assert.deepEqual((await backend.getDocument(id))!.annotations.map((a) => a.id), ['a0', 'a1', 'a2', 'a3']);

  const [newest] = await backend.listMarkBackups(id);
  assert.equal(newest.markCount, 1, 'the set that was live before the restore');
  await backend.restoreMarkBackup(id, newest.id);
  assert.deepEqual((await backend.getDocument(id))!.annotations.map((a) => a.id), ['b0']);
});

test('restore refuses an unknown or unsafe backup id', async (t) => {
  const { backend, id } = await tempStore(t);
  await backend.updateDocument(id, { annotations: marks(1) });
  assert.equal(await backend.restoreMarkBackup(id, '../../settings'), null);
  assert.equal(await backend.restoreMarkBackup(id, '123'), null);
  assert.equal(await backend.restoreMarkBackup('nothex', '1'), null);
  assert.deepEqual(await backend.listMarkBackups('../x'), []);
});

test('deleting a document removes its backups', async (t) => {
  const { backend, id, dir } = await tempStore(t);
  await backend.updateDocument(id, { annotations: marks(1) });
  await backend.updateDocument(id, { annotations: marks(2) });
  await backend.deleteDocument(id);
  await assert.rejects(fs.stat(dir));
});

test('linked marks: a save that deleted one side drops the dangling link on disk', async (t) => {
  const { backend, id } = await tempStore(t);
  const a = { id: 'a', page: 1, links: ['b'] } as StoredAnnotation;
  const b = { id: 'b', page: 2, links: ['a'] } as StoredAnnotation;
  await backend.updateDocument(id, { annotations: [a, b] });
  await backend.updateDocument(id, { annotations: [a] });
  const stored = (await backend.getDocument(id))!.annotations;
  assert.deepEqual(stored, [{ id: 'a', page: 1, themeIds: [] }]);
});

test('a 2.5.0 record (PDF marks, text marks, legacy notes) loads unchanged but for its theme list, and a no-link save keeps every mark as it was', async (t) => {
  const { root, backend, id } = await tempStore(t);
  const record = JSON.parse(await fs.readFile(path.join(root, 'documents', `${id}.json`), 'utf-8'));
  const annotations = [
    { id: 'p1', page: 2, kind: 'highlight', color: '#ff0', themeId: 't1', rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }], quote: 'q', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 't1', kind: 'underline', anchor: { paragraphIndex: 0, start: 0, end: 4 }, themeId: null, quote: 'Some' },
    { id: 'n1', kind: 'note', paragraphIndex: 0, title: 'Old', content: 'note', themeId: null, timestamp: 'Just now' }
  ];
  await fs.writeFile(path.join(root, 'documents', `${id}.json`), JSON.stringify({ ...record, annotations }));
  // The single themeId of 2.5.0 reads as a list (several themes per mark); nothing else changes.
  const asRead = annotations.map(({ themeId, ...rest }) => ({ ...rest, themeIds: themeId ? [themeId] : [] }));
  assert.deepEqual((await backend.getDocument(id))!.annotations, asRead);
  await backend.updateDocument(id, { annotations: [...asRead] });
  assert.deepEqual((await backend.getDocument(id))!.annotations, asRead);
});

test('time-spaced: no new backup while the newest is under 10 minutes old; one again after', async (t) => {
  const { backend, clock, id } = await tempStore(t);
  await backend.updateDocument(id, { annotations: marks(1) });
  await backend.updateDocument(id, { annotations: marks(2) }); // backs up [1 mark]
  clock.ms += 9 * MIN;
  await backend.updateDocument(id, { annotations: marks(3) });
  await backend.updateDocument(id, { annotations: marks(4) });
  assert.deepEqual((await backend.listMarkBackups(id)).map((b) => b.markCount), [1]);
  clock.ms += 2 * MIN;
  await backend.updateDocument(id, { annotations: marks(5) });
  assert.deepEqual((await backend.listMarkBackups(id)).map((b) => b.markCount), [4, 1]);
});

test('checkpoint (document left/closed) keeps the live set if it changed since the newest backup', async (t) => {
  const { backend, id } = await tempStore(t);
  assert.equal(await backend.checkpointMarkBackup(id), false, 'empty set: nothing to keep');
  await backend.updateDocument(id, { annotations: marks(1) });
  await backend.updateDocument(id, { annotations: marks(2) }); // backs up [1]
  await backend.updateDocument(id, { annotations: marks(3) }); // inside the window: skipped
  assert.equal(await backend.checkpointMarkBackup(id), true);
  assert.deepEqual((await backend.listMarkBackups(id)).map((b) => b.markCount), [3, 1]);
  assert.equal(await backend.checkpointMarkBackup(id), false, 'unchanged since the newest backup');
  assert.deepEqual((await backend.listMarkBackups(id)).map((b) => b.markCount), [3, 1]);
  assert.equal(await backend.checkpointMarkBackup('nothex'), false);
});

test('checkpointPending (app quit) backs up only documents whose changes were skipped by the window', async (t) => {
  const { backend, id } = await tempStore(t);
  const other = (await backend.saveDocument({ title: 'B2', text: 't', format: 'PDF' })).id;
  await backend.updateDocument(id, { annotations: marks(1) });
  await backend.updateDocument(id, { annotations: marks(2) });
  await backend.updateDocument(id, { annotations: marks(3) }); // skipped → pending
  await backend.updateDocument(other, { annotations: marks(1) }); // first set: nothing replaced, nothing pending
  assert.equal(await backend.checkpointPendingMarkBackups(), 1);
  assert.deepEqual((await backend.listMarkBackups(id)).map((b) => b.markCount), [3, 1]);
  assert.deepEqual(await backend.listMarkBackups(other), []);
  assert.equal(await backend.checkpointPendingMarkBackups(), 0, 'pending cleared');
});

test('restore inside the 10-minute window still backs the current set up first', async (t) => {
  const { backend, id } = await tempStore(t);
  await backend.updateDocument(id, { annotations: marks(4, 'a') });
  await backend.updateDocument(id, { annotations: marks(1, 'b') }); // backs up a*
  await backend.updateDocument(id, { annotations: marks(2, 'c') }); // window: skipped
  const [a] = await backend.listMarkBackups(id);
  await backend.restoreMarkBackup(id, a.id);
  const list = await backend.listMarkBackups(id);
  assert.equal(list[0].markCount, 2, 'the c* set, live before the restore');
});

test('a restore whose safety backup cannot be written does not restore', async (t) => {
  const { backend, id } = await tempStore(t);
  await backend.updateDocument(id, { annotations: marks(4, 'a') });
  await backend.updateDocument(id, { annotations: marks(1, 'b') });
  const [a] = await backend.listMarkBackups(id);
  const real = fsDefault.rename;
  t.mock.method(fsDefault, 'rename', async (from: string, to: string) => {
    if (to.includes(`${path.sep}backups${path.sep}`)) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return real(from, to);
  });
  await assert.rejects(backend.restoreMarkBackup(id, a.id));
  t.mock.restoreAll();
  assert.deepEqual((await backend.getDocument(id))!.annotations.map((m) => m.id), ['b0']);
});
