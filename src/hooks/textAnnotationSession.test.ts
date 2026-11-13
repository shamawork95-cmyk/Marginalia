/**
 * Run with: npx tsx --test src/hooks/textAnnotationSession.test.ts
 *
 * The text reader's annotation state without React: load (with migration), edits through the
 * shared 100-step history, saves only after an edit, group-aware selection.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTextAnnotationSession } from './textAnnotationSession';

/** Every session a test makes is disposed after it, so no 60 s debounce timer keeps the run alive. */
const live: Array<{ dispose(): Promise<boolean> }> = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.dispose()));
});

const legacyNote = {
  id: 'note-1', paragraphIndex: 0, color: 'yellow', title: 'Reader Note', content: 'Old words',
  author: 'M', timestamp: 'Just now', themeIds: [], start: 0, end: 5, kind: 'note'
};
const pdfMark = { id: 'an-1', page: 1, kind: 'highlight', themeIds: [], color: '#ff0', rects: [], createdAt: 'x' };
const paragraphs = ['Alpha beta.', 'Gamma delta.', 'Epsilon.'];

function setup(stored: unknown[] | null = [legacyNote, pdfMark]) {
  const saves: unknown[][] = [];
  let n = 0;
  const session = createTextAnnotationSession({
    load: async () => (stored ? { annotations: stored as never } : null),
    save: async (entries) => {
      saves.push(entries);
      return true;
    },
    delayMs: 60_000,
    now: () => '2026-10-29T12:00:00.000Z',
    newId: () => `id-${++n}`
  });
  live.push(session);
  return { session, saves };
}

test('loading migrates older notes and writes nothing', async () => {
  const { session, saves } = setup();
  await session.load();
  const state = session.getState();
  assert.equal(state.isLoaded, true);
  assert.deepEqual(state.marks.map((m) => [m.id, m.kind, m.text]), [['note-1', 'note', 'Old words']]);
  assert.equal(session.saver.pending(), null);
  await session.dispose();
  assert.deepEqual(saves, []);
});

test('the first edit saves the new shape with every other entry carried through', async () => {
  const { session, saves } = setup();
  await session.load();
  session.addMarks([{ paraIdx: 1, start: 0, end: 5 }], { kind: 'highlight', color: '#f00', themeIds: [] }, paragraphs);
  await session.saver.flush();
  assert.equal(saves.length, 1);
  const written = saves[0] as Array<Record<string, unknown>>;
  assert.deepEqual(written.map((e) => e.id), ['an-1', 'note-1', 'id-1']);
  assert.deepEqual(written[1].anchor, { paragraphIndex: 0, start: 0, end: 5 });
  assert.equal(written[1].content, undefined);
});

test('a document whose marks could not be read is never written', async () => {
  const { session, saves } = setup(null);
  await session.load();
  assert.equal(session.getState().isLoaded, false);
  session.addMarks([{ paraIdx: 0, start: 0, end: 5 }], { kind: 'highlight', color: '#f00', themeIds: [] }, paragraphs);
  await session.dispose();
  assert.deepEqual(saves, []);
  assert.deepEqual(session.getState().marks, []);
});

test('undo and redo walk edits and each one is saved', async () => {
  const { session, saves } = setup([]);
  await session.load();
  session.addMarks([{ paraIdx: 0, start: 0, end: 5 }], { kind: 'underline', color: '#f00', themeIds: [] }, paragraphs);
  session.recolour(['id-1'], '#00f');
  assert.equal(session.getState().marks[0].color, '#00f');
  session.undo();
  assert.equal(session.getState().marks[0].color, '#f00');
  assert.equal(session.getState().canRedo, true);
  await session.saver.flush();
  assert.equal((saves.at(-1) as Array<{ color: string }>)[0].color, '#f00');
  session.undo();
  assert.deepEqual(session.getState().marks, []);
  assert.equal(session.getState().canUndo, false);
  session.redo();
  assert.equal(session.getState().marks.length, 1);
});

test('one undo removes a whole multi-paragraph mark', async () => {
  const { session } = setup([]);
  await session.load();
  session.addMarks([{ paraIdx: 0, start: 6, end: 10 }, { paraIdx: 1, start: 0, end: 5 }], { kind: 'highlight', color: '#f00', themeIds: [] }, paragraphs);
  assert.equal(session.getState().marks.length, 2);
  session.undo();
  assert.deepEqual(session.getState().marks, []);
});

test('selecting one range selects its group; additive selection and delete-selected', async () => {
  const { session } = setup([]);
  await session.load();
  session.addMarks([{ paraIdx: 0, start: 0, end: 5 }, { paraIdx: 1, start: 0, end: 5 }], { kind: 'highlight', color: '#f00', themeIds: [] }, paragraphs);
  session.addMarks([{ paraIdx: 2, start: 0, end: 7 }], { kind: 'question', color: '#f00', themeIds: [] }, paragraphs);
  const [g1, g2, q] = session.getState().marks.map((m) => m.id);
  session.select([g2]);
  assert.deepEqual([...session.getState().selectedIds].sort(), [g1, g2].sort());
  session.select([q], { additive: true });
  assert.equal(session.getState().selectedIds.length, 3);
  session.deleteMarks(session.getState().selectedIds);
  assert.deepEqual(session.getState().marks, []);
  assert.deepEqual(session.getState().selectedIds, []);
});

test('retag files every range of a group under the theme', async () => {
  const { session } = setup([]);
  await session.load();
  session.addMarks([{ paraIdx: 0, start: 0, end: 5 }, { paraIdx: 1, start: 0, end: 5 }], { kind: 'strikeout', color: '#f00', themeIds: [] }, paragraphs);
  session.retag([session.getState().marks[0].id], ['key', 'ruin']);
  assert.deepEqual(session.getState().marks.map((m) => m.themeIds), [['key', 'ruin'], ['key', 'ruin']]);
});

test('a load that lands after dispose is ignored', async () => {
  let resolve!: (v: { annotations: never[] }) => void;
  const session = createTextAnnotationSession({
    load: () => new Promise((r) => (resolve = r)),
    save: async () => true
  });
  live.push(session);
  const loading = session.load();
  await session.dispose();
  resolve({ annotations: [legacyNote as never] });
  await loading;
  assert.equal(session.getState().isLoaded, false);
  assert.deepEqual(session.getState().marks, []);
});

test('subscribers hear about changes and getState is stable between them', async () => {
  const { session } = setup([]);
  let calls = 0;
  session.subscribe(() => calls++);
  await session.load();
  const before = session.getState();
  assert.equal(session.getState(), before);
  session.addMarks([{ paraIdx: 0, start: 0, end: 5 }], { kind: 'highlight', color: '#f00', themeIds: [] }, paragraphs);
  assert.ok(calls >= 2);
  assert.notEqual(session.getState(), before);
});
