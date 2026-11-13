/**
 * Run with: npx tsx --test src/utils/textMarkView.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markColor, planTextRanges, segmentParagraph, textMarkViews, uncoveredRanges } from './textMarkView';
import type { TextMark } from './textMarks';

const mark = (id: string, p: number, start: number, end: number, extra: Partial<TextMark> = {}): TextMark => ({
  id,
  kind: 'highlight',
  anchor: { paragraphIndex: p, start, end },
  themeIds: [],
  color: '#c89b3c',
  ...extra
});

test('segments cover the whole paragraph and list every mark over each piece', () => {
  const segs = segmentParagraph(10, [mark('a', 0, 2, 6), mark('b', 0, 4, 8)]);
  assert.deepEqual(segs, [
    { start: 0, end: 2, ids: [] },
    { start: 2, end: 4, ids: ['a'] },
    { start: 4, end: 6, ids: ['a', 'b'] },
    { start: 6, end: 8, ids: ['b'] },
    { start: 8, end: 10, ids: [] }
  ]);
});

test('empty and out-of-range anchors are clamped or ignored', () => {
  assert.deepEqual(segmentParagraph(5, [mark('n', 0, 0, 0), mark('x', 0, 3, 99)]), [
    { start: 0, end: 3, ids: [] },
    { start: 3, end: 5, ids: ['x'] }
  ]);
  assert.deepEqual(segmentParagraph(0, [mark('a', 0, 0, 4)]), []);
});

test('marking never toggles: ranges already covered by the same kind are skipped', () => {
  const marks = [mark('a', 0, 0, 5), mark('b', 0, 5, 9), mark('u', 1, 0, 9, { kind: 'underline' })];
  const ranges = [
    { paraIdx: 0, start: 1, end: 8 }, // covered by a + b together
    { paraIdx: 0, start: 7, end: 12 }, // runs past b
    { paraIdx: 1, start: 0, end: 4 } // only underlined there
  ];
  assert.deepEqual(uncoveredRanges(marks, ranges, 'highlight', false), ranges.slice(1));
});

test('a term and a plain highlight do not cover each other', () => {
  const marks = [mark('t', 0, 0, 9, { isTerminology: true })];
  const r = [{ paraIdx: 0, start: 0, end: 4 }];
  assert.deepEqual(uncoveredRanges(marks, r, 'highlight', false), r);
  assert.deepEqual(uncoveredRanges(marks, r, 'highlight', true), []);
});

test('the same words under another theme add that theme to the mark, not a second mark', () => {
  const marks = [mark('a', 0, 0, 9, { themeIds: ['love'] })];
  const r = [{ paraIdx: 0, start: 0, end: 4 }];
  assert.deepEqual(uncoveredRanges(marks, r, 'highlight', false, ['love']), []);
  assert.deepEqual(uncoveredRanges(marks, r, 'highlight', false, ['death']), r);
  assert.deepEqual(planTextRanges(marks, r, 'highlight', false, ['love'], '#a00'), { create: [], tag: [] });
  assert.deepEqual(planTextRanges(marks, r, 'highlight', false, ['death', 'love'], '#00a'), { create: [], tag: [{ id: 'a', themeIds: ['love', 'death'] }] });
});

test('words past the mark are marked anew; an untagged mark takes the theme and its colour', () => {
  const marks = [mark('a', 0, 0, 5)];
  const past = [{ paraIdx: 0, start: 3, end: 9 }];
  assert.deepEqual(planTextRanges(marks, past, 'highlight', false, ['ruin'], '#00a'), { create: past, tag: [] });
  const inside = [{ paraIdx: 0, start: 1, end: 4 }];
  assert.deepEqual(planTextRanges(marks, inside, 'highlight', false, ['ruin'], '#00a'), { create: [], tag: [{ id: 'a', themeIds: ['ruin'], color: '#00a' }] });
});

test('views: one per group, quote joined, paragraph as page, reading order kept within a paragraph', () => {
  const paragraphs = ['Alpha beta gamma delta.', 'Epsilon zeta.'];
  const marks = [
    mark('g2', 1, 0, 7, { groupId: 'g' }),
    mark('g1', 0, 17, 23, { groupId: 'g' }),
    mark('late', 0, 11, 16, { kind: 'note', text: 'Words' }),
    mark('early', 0, 0, 5, { isTerminology: true, color: '#000' })
  ];
  const views = textMarkViews(marks, paragraphs, '#5a7');
  assert.deepEqual(views.map((v) => v.id), ['g1', 'late', 'early']);
  const g = views[0];
  assert.equal(g.quote, 'delta. Epsilon');
  assert.equal(g.page, 1);
  assert.equal(views[2].color, '#5a7');
  // The notes panel orders by page then y (then x); y follows the character offset.
  const y = (id: string) => views.find((v) => v.id === id)!.rects![0].y;
  assert.ok(y('early') < y('late') && y('late') < y('g1'));
});

test('older palette names become colours; a missing colour takes the fallback', () => {
  assert.equal(markColor('yellow', '#000'), '#d4a017');
  assert.equal(markColor('#123456', '#000'), '#123456');
  assert.equal(markColor('', '#abc'), '#abc');
  assert.equal(markColor(undefined, '#abc'), '#abc');
});

test('views: an emptied quote shows none, and a note title leads the text the panel shows and searches', () => {
  const paragraphs = ['Alpha beta gamma delta.', 'Epsilon zeta.'];
  const views = textMarkViews(
    [
      mark('n', 0, 0, 5, { kind: 'note', title: 'On alpha', text: 'Words', quote: '' }),
      mark('t', 1, 0, 7, { kind: 'note', title: 'Only a title' }),
      mark('q', 1, 8, 12, { kind: 'note', text: 'Plain', quote: 'Edited words' })
    ],
    paragraphs,
    '#5a7'
  );
  const byId = new Map(views.map((v) => [v.id, v]));
  assert.equal(byId.get('n')!.quote, undefined);
  assert.equal(byId.get('n')!.text, 'On alpha\nWords');
  assert.equal(byId.get('t')!.text, 'Only a title');
  assert.equal(byId.get('q')!.text, 'Plain');
  assert.equal(byId.get('q')!.quote, 'Edited words');
});

test('reuseUnchanged keeps last render\'s list where nothing in it changed', async () => {
  const { reuseUnchanged } = await import('./textMarkView');
  const a = mark('a', 0, 0, 2);
  const b = mark('b', 1, 0, 2);
  const prev = new Map([[0, [a]], [1, [b]]]);
  const b2 = { ...b, color: '#000' };
  const next = reuseUnchanged(prev, new Map([[0, [a]], [1, [b2]], [2, [a]]]));
  assert.equal(next.get(0), prev.get(0));
  assert.notEqual(next.get(1), prev.get(1));
  assert.deepEqual(next.get(2), [a]);
  const byQuote = reuseUnchanged(new Map([[0, [{ m: a, q: 'x' }]]]), new Map([[0, [{ m: a, q: 'x' }]]]), (p, q) => p.m === q.m && p.q === q.q);
  assert.equal(byQuote.get(0)!.length, 1);
});
