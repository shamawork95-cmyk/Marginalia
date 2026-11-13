/**
 * Run with: npx tsx --test src/components/swipeTurn.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swipeStep } from './swipeTurn';

test('a quick sideways swipe turns: left is forward, right is back', () => {
  assert.equal(swipeStep(-120, 10, 200), 1);
  assert.equal(swipeStep(120, -10, 200), -1);
});

test('taps, short moves, slow drags and mostly-vertical moves do not turn', () => {
  assert.equal(swipeStep(-30, 0, 100), 0);
  // A clear sideways movement is more than 60 px.
  assert.equal(swipeStep(-59, 0, 100), 0);
  assert.equal(swipeStep(-61, 0, 100), 1);
  assert.equal(swipeStep(-200, 0, 1200), 0);
  assert.equal(swipeStep(-80, 70, 200), 0);
});
