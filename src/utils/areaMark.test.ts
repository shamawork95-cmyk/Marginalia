/**
 * Run with: npx tsx --test src/utils/areaMark.test.ts
 *
 * Area highlight: a rectangle dragged over a PDF page (a figure, a table, a scanned passage
 * without a text layer), stored as an ordinary highlight with one rect and `area: true`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaRectFromDrag, createAreaHighlight, isAreaHighlight } from './areaMark';
import { emptyHistory, historyCommit, historyUndo, historyRedo } from '../hooks/historyCore';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('a drag in any direction becomes a normalised rect with positive size', () => {
  const r = areaRectFromDrag({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 })!;
  near(r.x, 0.2);
  near(r.y, 0.1);
  near(r.w, 0.4);
  near(r.h, 0.4);
});

test('a drag past the page edge is clamped to the page', () => {
  assert.deepEqual(areaRectFromDrag({ x: -0.2, y: 0.5 }, { x: 0.3, y: 1.4 }), { x: 0, y: 0.5, w: 0.3, h: 0.5 });
});

test('a click or a sliver is not an area', () => {
  assert.equal(areaRectFromDrag({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 }), null);
  assert.equal(areaRectFromDrag({ x: 0.3, y: 0.3 }, { x: 0.302, y: 0.6 }), null);
  assert.equal(areaRectFromDrag({ x: NaN, y: 0 }, { x: 0.5, y: 0.5 }), null);
});

test('createAreaHighlight: page, rect, colour, theme, note, times, stored as a highlight', () => {
  const mark = createAreaHighlight(
    { page: 3, from: { x: 0.1, y: 0.1 }, to: { x: 0.5, y: 0.4 }, color: '#ffd400', themeIds: ['t1'], text: 'Figure 2' },
    { now: '2026-11-01T10:00:00.000Z', newId: () => 'area-1' }
  )!;
  assert.equal(mark.id, 'area-1');
  assert.equal(mark.page, 3);
  assert.equal(mark.kind, 'highlight');
  assert.equal(mark.area, true);
  assert.equal(mark.rects!.length, 1);
  near(mark.rects![0].w, 0.4);
  assert.equal(mark.color, '#ffd400');
  assert.deepEqual(mark.themeIds, ['t1']);
  assert.equal(mark.text, 'Figure 2');
  assert.equal(mark.createdAt, '2026-11-01T10:00:00.000Z');
  assert.equal(isAreaHighlight(mark), true);
});

test('no area for a bad page or a too-small drag', () => {
  const ctx = { now: 'x', newId: () => 'id' };
  const base = { from: { x: 0.1, y: 0.1 }, to: { x: 0.5, y: 0.5 }, color: '#000', themeIds: [] };
  assert.equal(createAreaHighlight({ ...base, page: 0 }, ctx), null);
  assert.equal(createAreaHighlight({ ...base, page: 1.5 }, ctx), null);
  assert.equal(createAreaHighlight({ ...base, page: 1, to: { x: 0.1, y: 0.1 } }, ctx), null);
});

test('an ordinary text highlight is not an area', () => {
  assert.equal(isAreaHighlight({ id: 'h', page: 1, kind: 'highlight', rects: [{ x: 0, y: 0, w: 1, h: 1 }] }), false);
});

test('undo and redo work on a list holding an area mark (shared history core)', () => {
  const area = createAreaHighlight(
    { page: 1, from: { x: 0, y: 0 }, to: { x: 0.5, y: 0.5 }, color: '#f00', themeIds: [] },
    { now: 'n', newId: () => 'a' }
  )!;
  const h0 = emptyHistory<typeof area>([]);
  const h1 = historyCommit(h0, [area])!;
  assert.deepEqual(historyUndo(h1)!.present, []);
  assert.deepEqual(historyRedo(historyUndo(h1)!)!.present, [area]);
});
