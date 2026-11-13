/**
 * Run with: npx tsx --test src/services/storage/localBackend.test.ts
 *
 * Every test works on its own temp store; the real library is never touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalDocumentBackend } from './localBackend';
import type { StoredAnnotation } from './types';

async function tempStore(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-store-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, backend: new LocalDocumentBackend(root) };
}

async function makeDoc(backend: LocalDocumentBackend, bytes = Buffer.from('%PDF-old')) {
  const meta = await backend.saveDocument({ title: 'Book', text: 'Some text', format: 'PDF', filename: 'book.pdf' });
  assert.equal(await backend.attachOriginal(meta.id, bytes, 'book.pdf'), true);
  return meta.id;
}

const mark = (id: string, page: number): StoredAnnotation => ({ id, page } as StoredAnnotation);

// ── Item 8: corrupt records ──────────────────────────────────────────────────

test('a record write keeps the previous version as {id}.json.bak', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  await backend.updateDocument(id, { title: 'Renamed' });
  const bak = JSON.parse(await fs.readFile(path.join(root, 'documents', `${id}.json.bak`), 'utf-8'));
  assert.equal(bak.title, 'Book');
});

test('a corrupt record falls back to its .bak and stays listed', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  await backend.updateDocument(id, { title: 'Renamed' });
  await fs.writeFile(path.join(root, 'documents', `${id}.json`), '{"title": "Ren');
  t.mock.method(console, 'error', () => {});
  assert.equal((await backend.getDocument(id))?.title, 'Book');
  assert.deepEqual((await backend.listDocuments()).map((d) => d.id), [id]);
});

test('a corrupt record with no usable .bak is logged and quarantined to .corrupt', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  const docs = path.join(root, 'documents');
  await fs.rm(path.join(docs, `${id}.json.bak`), { force: true });
  await fs.writeFile(path.join(docs, `${id}.json`), 'not json');
  const errors = t.mock.method(console, 'error', () => {});
  assert.equal(await backend.getDocument(id), null);
  // Timestamped name (`.json.corrupt-<time>`) so a later corruption cannot overwrite it.
  const [quarantined] = (await fs.readdir(docs)).filter((n) => n.startsWith(`${id}.json.corrupt`));
  assert.equal(await fs.readFile(path.join(docs, quarantined), 'utf-8'), 'not json');
  await assert.rejects(fs.access(path.join(docs, `${id}.json`)));
  assert.ok(errors.mock.callCount() >= 1);
});

test('the sweeper keeps an original whose record is only a .bak or a .corrupt file', async (t) => {
  const { root, backend } = await tempStore(t);
  const docs = path.join(root, 'documents');
  const onlyBak = await makeDoc(backend);
  const onlyCorrupt = await makeDoc(backend);
  await fs.rename(path.join(docs, `${onlyBak}.json`), path.join(docs, `${onlyBak}.json.bak`));
  await fs.rename(path.join(docs, `${onlyCorrupt}.json`), path.join(docs, `${onlyCorrupt}.json.corrupt`));
  await backend.sweepExpiredDocuments();
  await fs.access(path.join(root, 'originals', `${onlyBak}.pdf`));
  await fs.access(path.join(root, 'originals', `${onlyCorrupt}.pdf`));
});

// ── Item 1: originals are never overwritten in place ─────────────────────────

test('attachOriginal replaces the file by rename, not by writing into it', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  const file = path.join(root, 'originals', `${id}.pdf`);
  const before = (await fs.stat(file)).ino;
  await backend.attachOriginal(id, Buffer.from('%PDF-new'), 'book.pdf');
  assert.notEqual((await fs.stat(file)).ino, before);
  assert.equal(await fs.readFile(file, 'utf-8'), '%PDF-new');
});

test('a page edit swaps the original by rename and keeps the old bytes as {id}.prev', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  const file = path.join(root, 'originals', `${id}.pdf`);
  const before = (await fs.stat(file)).ino;
  const result = await backend.editPdfPages(id, async ({ annotations }) => ({
    pdf: Buffer.from('%PDF-edited'),
    annotations,
    result: 'ok'
  }));
  assert.equal(result, 'ok');
  assert.notEqual((await fs.stat(file)).ino, before);
  assert.equal(await fs.readFile(file, 'utf-8'), '%PDF-edited');
  assert.equal(await fs.readFile(path.join(root, 'originals', `${id}.prev`), 'utf-8'), '%PDF-old');
  assert.deepEqual((await fs.readdir(path.join(root, 'originals'))).sort(), [`${id}.pdf`, `${id}.prev`].sort());
  assert.equal((await backend.getOriginal(id))?.filename, 'book.pdf');
});

test('a page edit returns null for a document that does not exist', async (t) => {
  const { backend } = await tempStore(t);
  const result = await backend.editPdfPages('a'.repeat(32), async ({ annotations }) => ({
    pdf: Buffer.from('x'),
    annotations,
    result: 'ok'
  }));
  assert.equal(result, null);
});

// ── Item 2: marks and PDF change together ────────────────────────────────────

test('a page edit reads the marks inside the lock, after a write queued before it', async (t) => {
  const { backend } = await tempStore(t);
  const id = await makeDoc(backend);
  void backend.updateDocument(id, { annotations: [mark('a', 1), mark('b', 2)] });
  let seen: string[] = [];
  await backend.editPdfPages(id, async ({ annotations }) => {
    seen = annotations.map((a) => a.id);
    return { pdf: Buffer.from('%PDF-edited'), annotations: annotations.map((a) => ({ ...a, page: (a.page as number) + 1 })), result: 1 };
  });
  assert.deepEqual(seen, ['a', 'b']);
  assert.deepEqual((await backend.getDocument(id))?.annotations.map((a) => a.page), [2, 3]);
});

test('a crash during the PDF swap rolls forward to the new PDF and the new marks', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  await backend.updateDocument(id, { annotations: [mark('a', 1)] });
  const realRename = fs.rename;
  const rename = t.mock.method(fs, 'rename', async (from: string, to: string) => {
    if (String(from).endsWith(`${id}.next`)) throw new Error('simulated crash');
    return realRename(from, to);
  });
  await assert.rejects(
    backend.editPdfPages(id, async ({ annotations }) => ({
      pdf: Buffer.from('%PDF-edited'),
      annotations: annotations.map((a) => ({ ...a, page: (a.page as number) + 1 })),
      result: 1
    }))
  );
  rename.mock.restore();

  const restarted = new LocalDocumentBackend(root);
  assert.equal((await restarted.getOriginal(id))?.buffer.toString(), '%PDF-edited');
  assert.deepEqual((await restarted.getDocument(id))?.annotations.map((a) => a.page), [2]);
  assert.deepEqual((await fs.readdir(path.join(root, 'originals'))).sort(), [`${id}.pdf`, `${id}.prev`].sort());
});

test('a crash before the marks are committed keeps the old PDF and the old marks', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  await backend.updateDocument(id, { annotations: [mark('a', 1)] });
  const realRename = fs.rename;
  const rename = t.mock.method(fs, 'rename', async (from: string, to: string) => {
    if (String(to).endsWith(`${id}.json`)) throw new Error('simulated crash');
    return realRename(from, to);
  });
  await assert.rejects(
    backend.editPdfPages(id, async ({ annotations }) => ({
      pdf: Buffer.from('%PDF-edited'),
      annotations: annotations.map((a) => ({ ...a, page: (a.page as number) + 1 })),
      result: 1
    }))
  );
  rename.mock.restore();

  const restarted = new LocalDocumentBackend(root);
  assert.equal((await restarted.getOriginal(id))?.buffer.toString(), '%PDF-old');
  assert.deepEqual((await restarted.getDocument(id))?.annotations.map((a) => a.page), [1]);
  assert.ok(!(await fs.readdir(path.join(root, 'originals'))).includes(`${id}.next`));
});

test('deleting a document removes its .bak, .corrupt and .prev files too', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  await backend.editPdfPages(id, async ({ annotations }) => ({ pdf: Buffer.from('%PDF-e'), annotations, result: 1 }));
  await fs.writeFile(path.join(root, 'documents', `${id}.json.corrupt`), 'x');
  await backend.deleteDocument(id);
  assert.deepEqual(await fs.readdir(path.join(root, 'documents')), []);
  assert.deepEqual(await fs.readdir(path.join(root, 'originals')), []);
});

// ── Item 4: settings ─────────────────────────────────────────────────────────

test('client settings merge into the stored ones and never change gemini fields', async (t) => {
  const { backend } = await tempStore(t);
  await backend.saveSettings({ geminiApiKey: 'secret', geminiModel: 'm1', userName: 'A', activeThemes: [1] });
  await backend.saveClientSettings({ userName: 'B', geminiApiKey: '', geminiModel: 'other' });
  assert.deepEqual(await backend.getSettings(), {
    geminiApiKey: 'secret',
    geminiModel: 'm1',
    userName: 'B',
    activeThemes: [1]
  });
});

test('settings are written by rename, leaving no temp file behind', async (t) => {
  const { root, backend } = await tempStore(t);
  await backend.saveSettings({ a: 1 });
  const file = path.join(root, 'settings.json');
  const before = (await fs.stat(file)).ino;
  await backend.saveClientSettings({ a: 2 });
  assert.notEqual((await fs.stat(file)).ino, before);
  assert.deepEqual((await fs.readdir(root)).filter((n) => n.startsWith('settings')), ['settings.json']);
});

test('settings sent to the renderer carry no gemini fields', async () => {
  const { publicSettings } = await import('./types');
  assert.deepEqual(publicSettings({ geminiApiKey: 'secret', geminiModel: 'm', userName: 'A' }), { userName: 'A' });
  assert.equal(publicSettings(null), null);
});

// ── Phase A review fixes: one locked settings writer, unique corrupt copies ───

test('a gemini key write merges into the stored settings instead of replacing them', async (t) => {
  const { backend } = await tempStore(t);
  await backend.saveClientSettings({ userName: 'A', activeThemes: [1] });
  await backend.saveSettings({ geminiApiKey: 'k' });
  assert.deepEqual(await backend.getSettings(), { userName: 'A', activeThemes: [1], geminiApiKey: 'k' });
});

test('a key write racing a client settings write keeps both', async (t) => {
  const { backend } = await tempStore(t);
  await backend.saveClientSettings({ userName: 'A' });
  await Promise.all([backend.saveSettings({ geminiApiKey: 'k' }), backend.saveClientSettings({ userName: 'B' })]);
  assert.deepEqual(await backend.getSettings(), { userName: 'B', geminiApiKey: 'k' });
});

test('a corrupt settings.json is backed up to .bad before the key write', async (t) => {
  const { backend, root } = await tempStore(t);
  await fs.writeFile(path.join(root, 'settings.json'), '{not json');
  await backend.saveSettings({ geminiApiKey: 'k' });
  const bad = (await fs.readdir(root)).filter((n) => n.startsWith('settings.json.bad'));
  assert.equal(bad.length, 1);
  assert.equal(await fs.readFile(path.join(root, bad[0]), 'utf-8'), '{not json');
  assert.deepEqual(await backend.getSettings(), { geminiApiKey: 'k' });
});

test('a second settings corruption keeps the first .bad copy', async (t) => {
  const { backend, root } = await tempStore(t);
  await fs.writeFile(path.join(root, 'settings.json'), 'first');
  await backend.saveClientSettings({ a: 1 });
  await new Promise((r) => setTimeout(r, 2));
  await fs.writeFile(path.join(root, 'settings.json'), 'second');
  await backend.saveClientSettings({ a: 2 });
  const bad = (await fs.readdir(root)).filter((n) => n.startsWith('settings.json.bad')).sort();
  const contents = await Promise.all(bad.map((n) => fs.readFile(path.join(root, n), 'utf-8')));
  assert.deepEqual(contents.sort(), ['first', 'second']);
});

test('a second record corruption keeps the first .corrupt copy, and delete removes both', async (t) => {
  const { backend, root } = await tempStore(t);
  const id = await makeDoc(backend);
  const docs = path.join(root, 'documents');
  const errors = t.mock.method(console, 'error', () => {});
  await fs.writeFile(path.join(docs, `${id}.json`), 'first');
  await backend.getDocument(id);
  await new Promise((r) => setTimeout(r, 2));
  await fs.writeFile(path.join(docs, `${id}.json`), 'second');
  await backend.getDocument(id);
  errors.mock.restore();
  const corrupt = (await fs.readdir(docs)).filter((n) => n.startsWith(`${id}.json.corrupt`));
  const contents = await Promise.all(corrupt.map((n) => fs.readFile(path.join(docs, n), 'utf-8')));
  assert.deepEqual(contents.sort(), ['first', 'second']);
  await backend.deleteDocument(id);
  assert.deepEqual((await fs.readdir(docs)).filter((n) => n.startsWith(id)), []);
});

test('the gemini filter ignores case, on the way out and on the way in', async (t) => {
  const { publicSettings } = await import('./types');
  assert.deepEqual(publicSettings({ GeminiApiKey: 'secret', GEMINI_MODEL: 'm', userName: 'A' }), { userName: 'A' });
  const { backend } = await tempStore(t);
  await backend.saveClientSettings({ GeminiApiKey: 'from-client', userName: 'A' });
  assert.deepEqual(await backend.getSettings(), { userName: 'A' });
});

// ── Phase B1: text-mark migration keeps the old shape as the backup ─────────────────────────

test('the first save of migrated text marks leaves the legacy notes in {id}.json.bak', async (t) => {
  const { root, backend } = await tempStore(t);
  const meta = await backend.saveDocument({ title: 'Essay', text: 'One.\n\nTwo.', format: 'TXT', filename: 'essay.txt' });
  const legacy = [{ id: 'note-1', kind: 'note', paragraphIndex: 0, title: 'T', content: 'C', author: 'M', timestamp: 'Just now', themeId: null }];
  await backend.updateDocument(meta.id, { annotations: legacy as StoredAnnotation[] });
  const migrated = [{ id: 'note-1', kind: 'note', anchor: { paragraphIndex: 0, start: 0, end: 0 }, paragraphOnly: true, title: 'T', text: 'C edited', author: 'M', timestamp: 'Just now', themeId: null, updatedAt: '2026-10-29T12:00:00.000Z' }];
  await backend.updateDocument(meta.id, { annotations: migrated as StoredAnnotation[] });
  const bak = JSON.parse(await fs.readFile(path.join(root, 'documents', `${meta.id}.json.bak`), 'utf-8'));
  // As written then: the old fields, plus the theme list every save now carries.
  assert.deepEqual(bak.annotations, legacy.map((e) => ({ ...e, themeIds: [] })));
  assert.equal((await backend.getDocument(meta.id))?.annotations[0].text, 'C edited');
});

test('the legacy record survives later saves in {id}.json.legacy, written exactly once', async (t) => {
  const { root, backend } = await tempStore(t);
  const meta = await backend.saveDocument({ title: 'Essay', text: 'One.\n\nTwo.', format: 'TXT', filename: 'essay.txt' });
  const legacy = [{ id: 'note-1', kind: 'note', paragraphIndex: 0, title: 'T', content: 'C', author: 'M', timestamp: 'Just now', themeId: null }];
  await backend.updateDocument(meta.id, { annotations: legacy as StoredAnnotation[] });
  const legacyPath = path.join(root, 'documents', `${meta.id}.json.legacy`);
  const realRename = fs.rename;
  let legacyWrites = 0;
  t.mock.method(fs, 'rename', (from: string, to: string) => {
    if (to === legacyPath) legacyWrites++;
    return realRename(from, to);
  });
  const edited = (text: string) => [{ id: 'note-1', kind: 'note', anchor: { paragraphIndex: 0, start: 0, end: 0 }, paragraphOnly: true, title: 'T', text, author: 'M', timestamp: 'Just now', themeId: null }] as StoredAnnotation[];
  for (const text of ['C1', 'C2', 'C3']) await backend.updateDocument(meta.id, { annotations: edited(text) });
  const kept = JSON.parse(await fs.readFile(legacyPath, 'utf-8'));
  assert.deepEqual(kept.annotations, legacy.map((e) => ({ ...e, themeIds: [] })));
  assert.equal(legacyWrites, 1);
  assert.equal((await backend.getDocument(meta.id))?.annotations[0].text, 'C3');
});

test('a document with no legacy entries gets no {id}.json.legacy', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  await backend.updateDocument(id, { annotations: [mark('a', 1)] });
  await backend.updateDocument(id, { annotations: [mark('a', 1), mark('b', 2)] });
  assert.ok(!(await fs.readdir(path.join(root, 'documents'))).some((n) => n.endsWith('.legacy')));
});

test('a failed legacy copy stops the save, so the legacy record is not replaced', async (t) => {
  const { root, backend } = await tempStore(t);
  const meta = await backend.saveDocument({ title: 'Essay', text: 'One.', format: 'TXT', filename: 'essay.txt' });
  const legacy = [{ id: 'f-1', kind: 'format', type: 'bold', paragraphIndex: 0, start: 0, end: 3, themeId: null }];
  await backend.updateDocument(meta.id, { annotations: legacy as StoredAnnotation[] });
  const legacyPath = path.join(root, 'documents', `${meta.id}.json.legacy`);
  const realRename = fs.rename;
  t.mock.method(fs, 'rename', (from: string, to: string) =>
    to === legacyPath ? Promise.reject(Object.assign(new Error('disk full'), { code: 'ENOSPC' })) : realRename(from, to)
  );
  await assert.rejects(backend.updateDocument(meta.id, { annotations: [] }));
  const record = JSON.parse(await fs.readFile(path.join(root, 'documents', `${meta.id}.json`), 'utf-8'));
  assert.deepEqual(record.annotations, legacy.map((e) => ({ ...e, themeIds: [] })));
});

test('deleting a document removes its {id}.json.legacy too', async (t) => {
  const { root, backend } = await tempStore(t);
  const meta = await backend.saveDocument({ title: 'Essay', text: 'One.', format: 'TXT', filename: 'essay.txt' });
  const legacy = [{ id: 'f-1', kind: 'format', type: 'bold', paragraphIndex: 0, start: 0, end: 3, themeId: null }];
  await backend.updateDocument(meta.id, { annotations: legacy as StoredAnnotation[] });
  await backend.updateDocument(meta.id, { annotations: [] });
  assert.ok((await fs.readdir(path.join(root, 'documents'))).includes(`${meta.id}.json.legacy`));
  await backend.deleteDocument(meta.id);
  assert.deepEqual(await fs.readdir(path.join(root, 'documents')), []);
});

// ── 2.5.0: reading progress ──────────────────────────────────────────────────

test('a progress report is stored, keeps the furthest point and shows as a percentage in the list', async (t) => {
  const { backend } = await tempStore(t);
  const id = await makeDoc(backend);
  assert.equal((await backend.listDocuments())[0].progressPercent, null);
  await backend.updateDocument(id, { readingProgress: { position: 6, total: 10 } });
  const meta = await backend.updateDocument(id, { readingProgress: { position: 2, total: 10 } });
  assert.equal(meta?.progressPercent, 60);
  assert.deepEqual((await backend.getDocument(id))?.readingProgress, { position: 2, total: 10, furthest: 0.6 });
  assert.equal((await backend.listDocuments())[0].progressPercent, 60);
});

test('a progress report does not count as library activity', async (t) => {
  const { backend } = await tempStore(t);
  const id = await makeDoc(backend);
  const before = (await backend.getDocument(id))!.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  await backend.updateDocument(id, { readingProgress: { position: 1, total: 2 } });
  assert.equal((await backend.getDocument(id))!.updatedAt, before);
});

test('an invalid progress report leaves the stored progress alone', async (t) => {
  const { backend } = await tempStore(t);
  const id = await makeDoc(backend);
  await backend.updateDocument(id, { readingProgress: { position: 5, total: 10 } });
  await backend.updateDocument(id, { readingProgress: { position: 1, total: 0 } });
  assert.deepEqual((await backend.getDocument(id))?.readingProgress, { position: 5, total: 10, furthest: 0.5 });
});

// ── 2.5.0: pasted text layout ────────────────────────────────────────────────

test('pasted text keeps its layout and styles across saves; the list shows the layout but not the styles', async (t) => {
  const { backend } = await tempStore(t);
  const textStyles = [{ style: 'bold' as const, anchor: { paragraphIndex: 0, start: 2, end: 7 } }];
  const meta = await backend.saveDocument({ title: 'Poem', text: '  Shall I', format: 'TXT', layout: 'verbatim', textStyles });
  await backend.updateDocument(meta.id, { annotations: [{ id: 'm1' }] });
  const doc = await backend.getDocument(meta.id);
  assert.equal(doc?.layout, 'verbatim');
  assert.deepEqual(doc?.textStyles, textStyles);
  const listed = (await backend.listDocuments())[0] as unknown as Record<string, unknown>;
  assert.equal(listed.layout, 'verbatim');
  assert.equal('textStyles' in listed, false);
});

test('a document stored without a layout has none, so the reader keeps the original paragraph rule', async (t) => {
  const { backend } = await tempStore(t);
  const meta = await backend.saveDocument({ title: 'Old', text: 'x', format: 'TXT' });
  const doc = await backend.getDocument(meta.id);
  assert.equal(doc?.layout, undefined);
  assert.equal(doc?.textStyles, undefined);
});

// ── 2.5.0: thematic analysis removed; stored analyses are kept on disk ───────

test('an analysis stored before 2.5.0 stays in the record across saves, and the list no longer carries it', async (t) => {
  const { root, backend } = await tempStore(t);
  const id = await makeDoc(backend);
  const file = path.join(root, 'documents', `${id}.json`);
  const stored = { themes: [{ themeName: 'Loss', prominence: 'Primary' }], analysedAt: '2026-01-01T00:00:00.000Z', model: 'm' };
  await fs.writeFile(file, JSON.stringify({ ...JSON.parse(await fs.readFile(file, 'utf-8')), analysis: stored }));
  await backend.updateDocument(id, { annotations: [{ id: 'm1' }] });
  await backend.updateDocument(id, { title: 'Renamed' });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf-8')).analysis, stored);
  const listed = (await backend.listDocuments())[0] as unknown as Record<string, unknown>;
  assert.equal('analysis' in listed, false);
});

// ── Several themes per mark (Phase 3) ─────────────────────────────────────────

/** Writes a record the way an older version did: marks with a single `themeId`. */
async function oldRecord(root: string, backend: LocalDocumentBackend) {
  const meta = await backend.saveDocument({ title: 'Old', text: 'Words', format: 'PDF', filename: 'old.pdf' });
  const file = path.join(root, 'documents', `${meta.id}.json`);
  const rec = JSON.parse(await fs.readFile(file, 'utf-8'));
  rec.annotations = [
    { id: 'a', page: 1, kind: 'highlight', themeId: 'love', quote: 'first' },
    { id: 'b', page: 1, kind: 'underline', themeId: null, quote: 'second' }
  ];
  delete rec.themeIds;
  const raw = JSON.stringify(rec);
  await fs.writeFile(file, raw);
  return { id: meta.id as string, file, raw };
}

test('older single-theme marks read back with themeIds, and the counts follow', async (t) => {
  const { root, backend } = await tempStore(t);
  const { id } = await oldRecord(root, backend);
  const doc = await new LocalDocumentBackend(root).getDocument(id);
  assert.deepEqual(doc!.annotations.map((a) => [a.id, a.themeIds, 'themeId' in a]), [
    ['a', ['love'], false],
    ['b', [], false]
  ]);
  assert.deepEqual(doc!.themeIds, ['love']);
  assert.deepEqual(doc!.themeCounts, { love: 1 });
});

test('reading alone never rewrites an older record', async (t) => {
  const { root, backend } = await tempStore(t);
  const { id, file, raw } = await oldRecord(root, backend);
  const fresh = new LocalDocumentBackend(root);
  await fresh.getDocument(id);
  await fresh.listDocuments();
  assert.equal(await fs.readFile(file, 'utf-8'), raw);
  await assert.rejects(fs.access(`${file}.pre-themes`));
});

test('the first save keeps the old record once as {id}.json.pre-themes, then writes both fields', async (t) => {
  const { root, backend } = await tempStore(t);
  const { id, file, raw } = await oldRecord(root, backend);
  // A new run of the app, as after an update.
  const fresh = new LocalDocumentBackend(root);
  const doc = await fresh.getDocument(id);
  const edited = doc!.annotations.map((a) => (a.id === 'b' ? { ...a, themeIds: ['ruin', 'love'] } : a));
  await fresh.updateDocument(id, { annotations: edited });
  assert.equal(await fs.readFile(`${file}.pre-themes`, 'utf-8'), raw);
  const onDisk = JSON.parse(await fs.readFile(file, 'utf-8'));
  assert.deepEqual(onDisk.annotations.map((a: StoredAnnotation) => [a.id, a.themeIds, a.themeId]), [
    ['a', ['love'], 'love'],
    ['b', ['ruin', 'love'], 'ruin']
  ]);
  // Counted under every theme.
  assert.deepEqual(onDisk.themeCounts, { love: 2, ruin: 1 });
  // A later save, even in another run, never touches the copy.
  await new LocalDocumentBackend(root).updateDocument(id, { title: 'Renamed' });
  assert.equal(await fs.readFile(`${file}.pre-themes`, 'utf-8'), raw);
});

test('a record already in the new format gets no .pre-themes copy', async (t) => {
  const { root, backend } = await tempStore(t);
  const meta = await backend.saveDocument({ title: 'New', text: 'Words', format: 'PDF', filename: 'new.pdf' });
  await backend.updateDocument(meta.id, { annotations: [{ id: 'a', page: 1, themeIds: ['love'] } as StoredAnnotation] });
  await new LocalDocumentBackend(root).updateDocument(meta.id, { title: 'Again' });
  await assert.rejects(fs.access(path.join(root, 'documents', `${meta.id}.json.pre-themes`)));
});

test('if the .pre-themes copy cannot be written, the save does not happen', async (t) => {
  const { root, backend } = await tempStore(t);
  const { id, file, raw } = await oldRecord(root, backend);
  const fresh = new LocalDocumentBackend(root);
  const realRename = fs.rename;
  t.mock.method(fs, 'rename', async (from: string, to: string) => {
    if (to.endsWith('.pre-themes')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return realRename(from, to);
  });
  await assert.rejects(fresh.updateDocument(id, { title: 'Renamed' }));
  t.mock.restoreAll();
  assert.equal(await fs.readFile(file, 'utf-8'), raw);
});

test('a mark backup kept before the change comes back with themeIds when restored', async (t) => {
  const { root, backend } = await tempStore(t);
  const meta = await backend.saveDocument({ title: 'B', text: 'Words', format: 'PDF', filename: 'b.pdf' });
  const dir = path.join(root, 'backups', meta.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '1700000000000.json'), JSON.stringify({ savedAt: '2023-11-14T00:00:00.000Z', annotations: [{ id: 'a', page: 1, themeId: 'love' }] }));
  await backend.restoreMarkBackup(meta.id, '1700000000000');
  const doc = await backend.getDocument(meta.id);
  assert.deepEqual(doc!.annotations.map((a) => a.themeIds), [['love']]);
});
