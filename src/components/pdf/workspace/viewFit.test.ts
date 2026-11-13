/**
 * Run with: npx tsx --test src/components/pdf/workspace/viewFit.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, viewGrid } from './viewFit';

const a4 = { width: 595, height: 842 };
// The PDF area of a 1366×768 window with the sidebar open, roughly.
const small = { width: 1046, height: 640 };

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('grids: 1, 2 (book), 4 (2×2) and 6 (3×2)', () => {
  assert.deepEqual(viewGrid('single'), { cols: 1, rows: 1 });
  assert.deepEqual(viewGrid('spread'), { cols: 2, rows: 1 });
  assert.deepEqual(viewGrid('grid4'), { cols: 2, rows: 2 });
  assert.deepEqual(viewGrid('grid6'), { cols: 3, rows: 2 });
});

test('fit width fills the width; fit page also fits the height', () => {
  near(fitScale('single', a4, small, false), (1046 - 48) / 595);
  near(fitScale('single', a4, small, true), (640 - 40) / 842);
});

test('the book fits both pages in a small window: nothing runs under the sidebar or off the bottom', () => {
  const s = fitScale('spread', a4, small);
  assert.ok(2 * a4.width * s + 20 <= small.width - 48 + 1e-9);
  assert.ok(a4.height * s <= small.height - 40 + 1e-9);
});

test('four and six pages fit whole, two rows down', () => {
  for (const mode of ['grid4', 'grid6'] as const) {
    const s = fitScale(mode, a4, small);
    const { cols, rows } = viewGrid(mode);
    assert.ok(cols * a4.width * s + (cols - 1) * 20 <= small.width - 48 + 1e-9);
    assert.ok(rows * a4.height * s + (rows - 1) * 20 <= small.height - 40 + 1e-9);
  }
});
