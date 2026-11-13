/**
 * Run with: npx tsx --test src/components/pdf/textMarking.test.ts
 *
 * Making PDF marks from a selection: one mark per page, never a duplicate of the same kind and
 * theme over the same words, a second mark under another theme, and terms kept apart from
 * highlights.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAlreadyMarked, newTextMarks, type SelectionGroup } from './textMarking';
import type { Annotation } from './annotationModel';

const line = (y: number, x = 0.1, w = 0.6) => ({ x, y, w, h: 0.02 });
const mark = (extra: Partial<Annotation>): Annotation => ({
  id: 'm',
  page: 1,
  kind: 'highlight',
  color: '#aa0000',
  themeId: 'love',
  rects: [line(0.2), line(0.23)],
  quote: 'two lines',
  createdAt: '2026-11-13T00:00:00.000Z',
  ...extra
});
let n = 0;
const opts = (extra: Partial<Parameters<typeof newTextMarks>[2]> = {}) => ({
  kind: 'highlight' as const,
  isTerminology: false,
  themeId: 'love',
  color: '#aa0000',
  author: 'Reader',
  now: '2026-11-13T10:00:00.000Z',
  newId: () => `new-${++n}`,
  ...extra
});

test('a selection across a page break makes one mark per page, each with its own words', () => {
  const groups: SelectionGroup[] = [
    { page: 3, rects: [line(0.9)], quote: 'end of page three' },
    { page: 4, rects: [line(0.1)], quote: 'start of page four' }
  ];
  const made = newTextMarks([], groups, opts());
  assert.deepEqual(made.map((m) => [m.page, m.quote]), [
    [3, 'end of page three'],
    [4, 'start of page four']
  ]);
  assert.equal(made[0].themeId, 'love');
  assert.equal(made[0].author, 'Reader');
  assert.equal(made[0].createdAt, '2026-11-13T10:00:00.000Z');
  assert.equal(made[0].isTerminology, undefined);
});

test('the same words, kind and theme are not marked twice, even re-selected a little wider', () => {
  const existing = [mark({})];
  const again: SelectionGroup = { page: 1, rects: [line(0.2, 0.095, 0.61), line(0.23)], quote: 'two lines' };
  assert.equal(isAlreadyMarked(existing, again, 'highlight', false, 'love'), true);
  assert.deepEqual(newTextMarks(existing, [again], opts()), []);
});

test('the same words under another theme get a second mark', () => {
  const existing = [mark({})];
  const group: SelectionGroup = { page: 1, rects: [line(0.2), line(0.23)], quote: 'two lines' };
  assert.equal(isAlreadyMarked(existing, group, 'highlight', false, 'death'), false);
  const made = newTextMarks(existing, [group], opts({ themeId: 'death', color: '#0000aa' }));
  assert.equal(made.length, 1);
  assert.equal(made[0].themeId, 'death');
});

test('a longer selection reaching new lines is marked; a term and a highlight never cover each other', () => {
  const existing = [mark({})];
  const longer: SelectionGroup = { page: 1, rects: [line(0.2), line(0.23), line(0.26)], quote: 'three lines' };
  assert.equal(isAlreadyMarked(existing, longer, 'highlight', false, 'love'), false);
  assert.equal(isAlreadyMarked(existing, { page: 1, rects: [line(0.2)] }, 'highlight', true, 'love'), false);
  assert.equal(isAlreadyMarked(existing, { page: 1, rects: [line(0.2)] }, 'underline', false, 'love'), false);
  assert.equal(isAlreadyMarked(existing, { page: 2, rects: [line(0.2)] }, 'highlight', false, 'love'), false);
  const term = newTextMarks(existing, [{ page: 1, rects: [line(0.2)], quote: 'two' }], opts({ isTerminology: true }));
  assert.equal(term[0].isTerminology, true);
});

test('only the pages not already marked are added', () => {
  const existing = [mark({ page: 5, rects: [line(0.1)] })];
  const made = newTextMarks(
    existing,
    [
      { page: 5, rects: [line(0.1)], quote: 'already' },
      { page: 6, rects: [line(0.1)], quote: 'new' }
    ],
    opts()
  );
  assert.deepEqual(made.map((m) => m.page), [6]);
});
