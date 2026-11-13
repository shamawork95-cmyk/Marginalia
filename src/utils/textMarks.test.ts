/**
 * Run with: npx tsx --test src/utils/textMarks.test.ts
 *
 * Fixtures are shaped like real stored records: what ReaderScreen and `toggleFormatRange` wrote,
 * after a JSON round trip (so no `undefined` fields).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  migrateTextEntries, isTextMark, createTextMarks, updateTextMarks, deleteTextMarks,
  expandToGroups, sortTextMarks, groupHeads, type TextMark
} from './textMarks';

/** A note from before `createdAt` existed: the literal "Just now", with offsets. */
const justNowNote = {
  id: 'note-1729000000000',
  paragraphIndex: 3,
  color: 'yellow',
  title: 'Reader Note',
  content: 'Compare with chapter two.',
  author: 'Muzammil',
  timestamp: 'Just now',
  themeIds: ['key'],
  quote: 'the fitness between form and context',
  start: 12,
  end: 49,
  kind: 'note'
};

/** A newer note: dated, no offsets (made from the "add note" button on a paragraph). */
const datedNote = {
  id: 'note-1730000000000',
  paragraphIndex: 0,
  color: '#435c52',
  title: 'Opening',
  content: 'Sets the frame.',
  author: 'Muzammil',
  timestamp: 'Oct 29, 2026, 10:15 AM',
  createdAt: '2026-10-29T10:15:00.000Z',
  themeIds: [],
  kind: 'note'
};

const highlightFormat = {
  id: 'fmt-mf1abc-x9y8z7',
  paragraphIndex: 3,
  start: 0,
  end: 11,
  type: 'highlight',
  color: '#c89b3c',
  themeIds: ['key'],
  kind: 'format'
};

/** An older format saved with no colour, and a circle with a thickness. */
const bareBold = { id: 'fmt-b', paragraphIndex: 1, start: 4, end: 9, type: 'bold', themeIds: [], kind: 'format' };
const circle = { id: 'fmt-c', paragraphIndex: 2, start: 0, end: 5, type: 'circle', color: '#8b5cf6', thickness: 3, themeIds: [], kind: 'format' };

/** PDF marks in the same list: one is a PDF sticky note, which also says `kind: 'note'`. */
const pdfHighlight = { id: 'an-1', page: 2, kind: 'highlight', color: '#ff0', themeIds: [], rects: [{ x: 0, y: 0, w: 1, h: 0.1 }], createdAt: '2026-01-01T00:00:00.000Z' };
const pdfNote = { id: 'an-2', page: 4, kind: 'note', color: '#ff0', themeIds: [], box: { x: 0, y: 0, w: 0.2, h: 0.1 }, text: 'pdf', createdAt: '2026-01-01T00:00:00.000Z' };

test('a legacy "Just now" note becomes a note mark with its offsets and no invented date', () => {
  const { marks, migrated } = migrateTextEntries([justNowNote]);
  assert.equal(migrated, true);
  assert.deepEqual(marks, [
    {
      id: 'note-1729000000000',
      kind: 'note',
      anchor: { paragraphIndex: 3, start: 12, end: 49 },
      color: 'yellow',
      themeIds: ['key'],
      title: 'Reader Note',
      text: 'Compare with chapter two.',
      author: 'Muzammil',
      timestamp: 'Just now',
      quote: 'the fitness between form and context'
    }
  ]);
});

test('a note saved without offsets is attached to its whole paragraph', () => {
  const [mark] = migrateTextEntries([datedNote]).marks;
  assert.deepEqual(mark.anchor, { paragraphIndex: 0, start: 0, end: 0 });
  assert.equal(mark.paragraphOnly, true);
  assert.equal(mark.createdAt, '2026-10-29T10:15:00.000Z');
});

test('formats become marks of their own type', () => {
  const { marks } = migrateTextEntries([highlightFormat, bareBold, circle]);
  assert.deepEqual(marks, [
    { id: 'fmt-mf1abc-x9y8z7', kind: 'highlight', anchor: { paragraphIndex: 3, start: 0, end: 11 }, color: '#c89b3c', themeIds: ['key'] },
    { id: 'fmt-b', kind: 'bold', anchor: { paragraphIndex: 1, start: 4, end: 9 }, themeIds: [] },
    { id: 'fmt-c', kind: 'circle', anchor: { paragraphIndex: 2, start: 0, end: 5 }, color: '#8b5cf6', thickness: 3, themeIds: [] }
  ]);
});

test('PDF marks, including a PDF sticky note, are carried through untouched', () => {
  const { marks, others } = migrateTextEntries([pdfHighlight, justNowNote, pdfNote]);
  assert.deepEqual(marks.map((m) => m.id), ['note-1729000000000']);
  assert.deepEqual(others, [pdfHighlight, pdfNote]);
});

test('an entry that only looks legacy (paragraphIndex not a number) is kept, not dropped', () => {
  const odd = { id: 'odd', kind: 'format', paragraphIndex: '3', start: 0, end: 1, type: 'bold' };
  const { marks, others } = migrateTextEntries([odd]);
  assert.deepEqual(marks, []);
  assert.deepEqual(others, [odd]);
});

test('marks already in the new shape pass through and do not count as a migration', () => {
  const mark: TextMark = { id: 'tm-1', kind: 'strikeout', anchor: { paragraphIndex: 5, start: 2, end: 8 }, themeIds: [], color: '#000', createdAt: '2026-10-29T00:00:00.000Z' };
  assert.equal(isTextMark(mark), true);
  const { marks, others, migrated } = migrateTextEntries([mark as never]);
  assert.deepEqual(marks, [mark]);
  assert.deepEqual(others, []);
  assert.equal(migrated, false);
});

// ── Model operations ────────────────────────────────────────────────────────────────────────

const paragraphs = ['Alpha beta gamma.', 'Delta epsilon.', 'Zeta eta theta iota.'];
const NOW = '2026-10-29T12:00:00.000Z';
const LATER = '2026-10-29T12:05:00.000Z';
let seq = 0;
const ctx = { paragraphs, now: NOW, newId: () => `id-${++seq}` };

test('one range makes one mark with its quote, times and no group', () => {
  const [mark, ...rest] = createTextMarks([{ paraIdx: 0, start: 6, end: 10 }], { kind: 'highlight', color: '#ff0', themeIds: ['key'] }, ctx);
  assert.equal(rest.length, 0);
  assert.equal(mark.groupId, undefined);
  assert.deepEqual(mark.anchor, { paragraphIndex: 0, start: 6, end: 10 });
  assert.equal(mark.quote, 'beta');
  assert.equal(mark.createdAt, NOW);
  assert.equal(mark.updatedAt, NOW);
  assert.equal(mark.kind, 'highlight');
  assert.deepEqual(mark.themeIds, ['key']);
});

test('a selection over three paragraphs makes three linked ranges sharing one groupId', () => {
  const marks = createTextMarks(
    [{ paraIdx: 0, start: 11, end: 16 }, { paraIdx: 1, start: 0, end: 14 }, { paraIdx: 2, start: 0, end: 4 }],
    { kind: 'strikeout', color: '#000', themeIds: [], strokeStyle: 'dashed' },
    ctx
  );
  assert.equal(marks.length, 3);
  assert.equal(new Set(marks.map((m) => m.id)).size, 3);
  assert.ok(marks[0].groupId);
  assert.ok(marks.every((m) => m.groupId === marks[0].groupId));
  assert.deepEqual(marks.map((m) => m.quote), ['gamma', 'Delta epsilon.', 'Zeta']);
  assert.ok(marks.every((m) => m.strokeStyle === 'dashed'));
});

test('recolouring one range of a group recolours the whole group and stamps updatedAt', () => {
  const group = createTextMarks([{ paraIdx: 0, start: 0, end: 5 }, { paraIdx: 1, start: 0, end: 5 }], { kind: 'underline', color: '#111', themeIds: [] }, ctx);
  const [other] = createTextMarks([{ paraIdx: 2, start: 0, end: 4 }], { kind: 'highlight', color: '#222', themeIds: [] }, ctx);
  const next = updateTextMarks([...group, other], [group[1].id], { color: '#f00', themeIds: ['key'] }, LATER);
  assert.deepEqual(next.slice(0, 2).map((m) => [m.color, m.themeIds, m.updatedAt]), [['#f00', ['key'], LATER], ['#f00', ['key'], LATER]]);
  assert.deepEqual(next.slice(0, 2).map((m) => m.anchor), group.map((m) => m.anchor));
  assert.equal(next[2], other);
});

test('an update that changes nothing keeps the very same objects', () => {
  const marks = createTextMarks([{ paraIdx: 0, start: 0, end: 5 }], { kind: 'highlight', color: '#111', themeIds: [] }, ctx);
  const next = updateTextMarks(marks, [marks[0].id], { color: '#111' }, LATER);
  assert.equal(next[0], marks[0]);
});

test('deleting one range of a group deletes every range of it', () => {
  const group = createTextMarks([{ paraIdx: 0, start: 0, end: 5 }, { paraIdx: 1, start: 0, end: 5 }], { kind: 'highlight', color: '#111', themeIds: [] }, ctx);
  const [other] = createTextMarks([{ paraIdx: 2, start: 0, end: 4 }], { kind: 'highlight', color: '#222', themeIds: [] }, ctx);
  assert.deepEqual(deleteTextMarks([...group, other], [group[0].id]), [other]);
});

test('expandToGroups adds the other ranges of any group named', () => {
  const group = createTextMarks([{ paraIdx: 0, start: 0, end: 5 }, { paraIdx: 1, start: 0, end: 5 }], { kind: 'highlight', color: '#111', themeIds: [] }, ctx);
  const [other] = createTextMarks([{ paraIdx: 2, start: 0, end: 4 }], { kind: 'highlight', color: '#222', themeIds: [] }, ctx);
  assert.deepEqual([...expandToGroups([...group, other], [group[1].id])].sort(), group.map((m) => m.id).sort());
});

test('sortTextMarks puts marks in reading order: paragraph, then offset', () => {
  const at = (id: string, p: number, s: number): TextMark => ({ id, kind: 'highlight', anchor: { paragraphIndex: p, start: s, end: s + 1 }, themeIds: [] });
  assert.deepEqual(sortTextMarks([at('c', 2, 0), at('b', 0, 9), at('a', 0, 2)]).map((m) => m.id), ['a', 'b', 'c']);
});

test('groupHeads keeps the first range of each group in reading order', () => {
  const g = (id: string, p: number): TextMark => ({ id, kind: 'note', anchor: { paragraphIndex: p, start: 0, end: 1 }, themeIds: [], groupId: 'g' });
  assert.deepEqual(groupHeads([g('second', 4), g('first', 1)]).map((m) => m.id), ['first']);
});

test('a legacy note keeps fields this model does not know, and the converted ones are not duplicated', () => {
  const [mark] = migrateTextEntries([{ ...justNowNote, pinned: true, source: { app: 'old' } } as never]).marks;
  assert.equal((mark as unknown as Record<string, unknown>).pinned, true);
  assert.deepEqual((mark as unknown as Record<string, unknown>).source, { app: 'old' });
  assert.equal(mark.text, 'Compare with chapter two.');
  for (const consumed of ['content', 'paragraphIndex', 'start', 'end']) assert.ok(!(consumed in mark), consumed);
});

test('a legacy note field of the wrong type is still dropped, not carried through', () => {
  const [mark] = migrateTextEntries([{ ...justNowNote, title: 42 } as never]).marks;
  assert.ok(!('title' in mark));
});

test('a quote edit is a patch: a single note takes the new words', () => {
  const [note] = createTextMarks([{ paraIdx: 1, start: 0, end: 0 }], { kind: 'note', themeIds: [], text: 'Hm', paragraphOnly: true }, ctx);
  const [next] = updateTextMarks([note], [note.id], { quote: 'A line from elsewhere' }, LATER);
  assert.equal(next.quote, 'A line from elsewhere');
  assert.equal(next.updatedAt, LATER);
  assert.deepEqual(next.anchor, note.anchor);
});

test('a quote edit on a grouped note puts the words on the first range and silences the rest', () => {
  const group = createTextMarks([{ paraIdx: 0, start: 11, end: 16 }, { paraIdx: 1, start: 0, end: 5 }], { kind: 'note', themeIds: [], text: 'x' }, ctx);
  const next = updateTextMarks([...group].reverse(), [group[1].id], { quote: 'gamma, Delta' }, LATER);
  const byId = new Map(next.map((m) => [m.id, m]));
  assert.equal(byId.get(group[0].id)!.quote, 'gamma, Delta');
  assert.equal(byId.get(group[1].id)!.quote, '');
});

test('a new note given a quote puts it on its first range and silences the rest', () => {
  const marks = createTextMarks(
    [{ paraIdx: 0, start: 11, end: 16 }, { paraIdx: 1, start: 0, end: 5 }],
    { kind: 'note', themeIds: [], text: 'Hm', quote: 'edited words' },
    ctx
  );
  assert.deepEqual(marks.map((m) => m.quote), ['edited words', '']);
  const [plain] = createTextMarks([{ paraIdx: 0, start: 6, end: 10 }], { kind: 'note', themeIds: [], text: 'x' }, ctx);
  assert.equal(plain.quote, 'beta');
});
