/**
 * Run with: npx tsx --test src/components/pdf/textMarking.test.ts
 *
 * Making PDF marks from a selection: one mark per page, never a duplicate of the same kind over
 * the same words; re-marking them under another theme adds that theme to the mark already there;
 * terms kept apart from highlights.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAlreadyMarked, planTextMarks, type SelectionGroup } from './textMarking';
import type { Annotation } from './annotationModel';

const line = (y: number, x = 0.1, w = 0.6) => ({ x, y, w, h: 0.02 });
const mark = (extra: Partial<Annotation>): Annotation => ({
  id: 'm',
  page: 1,
  kind: 'highlight',
  color: '#aa0000',
  themeIds: ['love'],
  rects: [line(0.2), line(0.23)],
  quote: 'two lines',
  createdAt: '2026-11-13T00:00:00.000Z',
  ...extra
});
let n = 0;
const opts = (extra: Partial<Parameters<typeof planTextMarks>[2]> = {}) => ({
  kind: 'highlight' as const,
  isTerminology: false,
  themeIds: ['love'],
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
  const { created, tagged } = planTextMarks([], groups, opts({ themeIds: ['love', 'ruin'] }));
  assert.deepEqual(created.map((m) => [m.page, m.quote]), [
    [3, 'end of page three'],
    [4, 'start of page four']
  ]);
  assert.deepEqual(created[0].themeIds, ['love', 'ruin']);
  assert.equal(created[0].author, 'Reader');
  assert.equal(created[0].createdAt, '2026-11-13T10:00:00.000Z');
  assert.equal(created[0].isTerminology, undefined);
  assert.deepEqual(tagged, []);
});

test('the same words, kind and theme are not marked twice, even re-selected a little wider', () => {
  const existing = [mark({})];
  const again: SelectionGroup = { page: 1, rects: [line(0.2, 0.095, 0.61), line(0.23)], quote: 'two lines' };
  assert.equal(isAlreadyMarked(existing, again, 'highlight', false, ['love']), true);
  assert.deepEqual(planTextMarks(existing, [again], opts()), { created: [], tagged: [] });
});

test('the same words under another theme add that theme to the mark already there', () => {
  const existing = [mark({})];
  const group: SelectionGroup = { page: 1, rects: [line(0.2), line(0.23)], quote: 'two lines' };
  assert.equal(isAlreadyMarked(existing, group, 'highlight', false, ['death']), false);
  const plan = planTextMarks(existing, [group], opts({ themeIds: ['death'], color: '#0000aa' }));
  assert.deepEqual(plan.created, []);
  // The main theme (its colour) stays first; no colour change.
  assert.deepEqual(plan.tagged, [{ id: 'm', themeIds: ['love', 'death'] }]);
});

test('an untagged mark that gets a theme takes that theme as its main one, and its colour', () => {
  const existing = [mark({ themeIds: [] })];
  const plan = planTextMarks(existing, [{ page: 1, rects: [line(0.2), line(0.23)], quote: 'x' }], opts({ themeIds: ['ruin'], color: '#3f6fb5' }));
  assert.deepEqual(plan.tagged, [{ id: 'm', themeIds: ['ruin'], color: '#3f6fb5' }]);
});

test('a longer selection reaching new lines is marked; a term and a highlight never cover each other', () => {
  const existing = [mark({})];
  const longer: SelectionGroup = { page: 1, rects: [line(0.2), line(0.23), line(0.26)], quote: 'three lines' };
  assert.equal(isAlreadyMarked(existing, longer, 'highlight', false, ['love']), false);
  assert.equal(planTextMarks(existing, [longer], opts({ themeIds: ['ruin'] })).created.length, 1);
  assert.equal(isAlreadyMarked(existing, { page: 1, rects: [line(0.2)] }, 'highlight', true, ['love']), false);
  assert.equal(isAlreadyMarked(existing, { page: 1, rects: [line(0.2)] }, 'underline', false, ['love']), false);
  assert.equal(isAlreadyMarked(existing, { page: 2, rects: [line(0.2)] }, 'highlight', false, ['love']), false);
  const term = planTextMarks(existing, [{ page: 1, rects: [line(0.2)], quote: 'two' }], opts({ isTerminology: true }));
  assert.equal(term.created[0].isTerminology, true);
});

test('only the pages not already marked are added', () => {
  const existing = [mark({ page: 5, rects: [line(0.1)] })];
  const { created } = planTextMarks(
    existing,
    [
      { page: 5, rects: [line(0.1)], quote: 'already' },
      { page: 6, rects: [line(0.1)], quote: 'new' }
    ],
    opts()
  );
  assert.deepEqual(created.map((m) => m.page), [6]);
});

test('black it out, words: a solid bar per selected line, slightly larger, with no quote or theme', async () => {
  const { blackoutMarks } = await import('./textMarking');
  const marks = blackoutMarks(
    [
      { page: 2, rects: [line(0.3), line(0.33, 0.1, 0.4)], quote: 'secret words' },
      { page: 3, rects: [line(0.05, 0)], quote: 'more' }
    ],
    { color: '#000000', author: 'Reader', now: '2026-11-13T10:00:00.000Z', newId: () => `b-${++n}` }
  );
  assert.equal(marks.length, 3);
  assert.deepEqual(marks.map((m) => [m.page, m.kind, m.filled, m.blackout, m.quote, m.themeIds.length]), [
    [2, 'rect', true, true, undefined, 0],
    [2, 'rect', true, true, undefined, 0],
    [3, 'rect', true, true, undefined, 0]
  ]);
  const b = marks[0].box!;
  assert.ok(b.x < 0.1 && b.y < 0.3 && b.x + b.w > 0.7 && b.y + b.h > 0.32);
  // Clamped to the page.
  assert.ok(marks[2].box!.x >= 0);
});
