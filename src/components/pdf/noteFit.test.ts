/**
 * Run with: npx tsx --test src/components/pdf/noteFit.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitText, wrapLines, type Measure } from './noteFit';

/** Every character is half the size wide: a simple, predictable face. */
const measure: Measure = (text, size) => text.length * size * 0.5;
const base = { widthPt: 100, lineFactor: 1.25, minSize: 6, continuation: '… continued in Notes, p. 3' };
const LONG = 'The lone and level sands stretch far away, and nothing beside remains of the colossal wreck, boundless and bare.';

test('wrapping keeps explicit line breaks and never splits a word', () => {
  assert.deepEqual(wrapLines('one two three\nfour', 10, 50, measure), ['one two', 'three', 'four']);
  assert.deepEqual(wrapLines('extraordinarily', 10, 20, measure), ['extraordinarily']);
});

test('text that fits stays at its size', () => {
  const fit = fitText('Look on my works', { ...base, heightPt: 40, size: 10 }, measure);
  assert.equal(fit.size, 10);
  assert.equal(fit.overflow, false);
  assert.deepEqual(fit.lines, ['Look on my works']);
});

test('text that does not fit shrinks until every word is in the box', () => {
  const fit = fitText(LONG, { ...base, heightPt: 60, size: 12 }, measure);
  assert.equal(fit.overflow, false);
  assert.ok(fit.size < 12 && fit.size >= 6);
  assert.ok(fit.lines.length * fit.lineHeight <= 60);
  assert.equal(fit.lines.join(' '), LONG);
});

test('past the smallest size, the box ends with where the rest went, and nothing is lost', () => {
  const text = `${LONG} ${LONG} ${LONG}`;
  const fit = fitText(text, { ...base, heightPt: 30, size: 12 }, measure);
  assert.equal(fit.overflow, true);
  assert.equal(fit.size, 6);
  assert.ok(fit.lines.length * fit.lineHeight <= 30 + 1e-6);
  assert.equal(fit.lines[fit.lines.length - 1], '… continued in Notes, p. 3');
  // The kept lines are the start of the text, in order.
  assert.ok(text.replace(/\s+/g, ' ').startsWith(fit.lines.slice(0, -1).join(' ')));
});

test('a box too small for one line still says where the text went', () => {
  const fit = fitText(LONG, { ...base, heightPt: 5, size: 12 }, measure);
  assert.deepEqual(fit.lines, ['… continued in Notes, p. 3']);
  assert.equal(fit.overflow, true);
});
