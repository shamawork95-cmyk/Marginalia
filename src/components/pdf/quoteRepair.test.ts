/**
 * Run with: npx tsx --test src/components/pdf/quoteRepair.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeAppChrome, quoteFromTextItems, repairQuote, stripAppChrome, type PlacedTextItem } from './quoteRepair';

const POLLUTED =
  'MY COLLECTIONS ADD DOCUMENT SETTINGS SEARCH SEND FEEDBACK Marginalia • Annotator For close readers, Built with care by Shama Iqbal Hussain. THEME Key Concepts Questions Metaphors Untagged I met a traveller from an antique land';

test('chrome is recognised; ordinary quotes (even with one such word) are not', () => {
  assert.equal(looksLikeAppChrome(POLLUTED), true);
  assert.equal(looksLikeAppChrome('SEARCH for the THEME of the poem'), true);
  assert.equal(looksLikeAppChrome('I met a traveller from an antique land'), false);
  assert.equal(looksLikeAppChrome('The SEARCH party set out'), false);
  assert.equal(looksLikeAppChrome(''), false);
});

test('stripping removes the labels and the theme names beside them', () => {
  assert.equal(stripAppChrome(POLLUTED, ['Key Concepts', 'Questions', 'Metaphors']), 'I met a traveller from an antique land');
});

// Two lines of text: "I met a traveller" over "from an antique land", each one item.
const items: PlacedTextItem[] = [
  { str: 'I met a traveller', box: { x: 0.1, y: 0.2, w: 0.34, h: 0.02 }, eol: true },
  { str: 'from an antique land', box: { x: 0.1, y: 0.23, w: 0.4, h: 0.02 } },
  { str: 'Page 1', box: { x: 0.45, y: 0.95, w: 0.1, h: 0.015 } }
];

test('the quote is rebuilt from the items under the rects, across lines', () => {
  const rects = [
    { x: 0.1, y: 0.199, w: 0.34, h: 0.022 },
    { x: 0.1, y: 0.229, w: 0.4, h: 0.022 }
  ];
  assert.equal(quoteFromTextItems(items, rects), 'I met a traveller from an antique land');
});

test('a rect covering part of a line takes only the characters inside it', () => {
  // "traveller" sits in the last 9 of 17 characters: x from 0.1 + 0.34 * 8/17.
  const x = 0.1 + (0.34 * 8) / 17;
  assert.equal(quoteFromTextItems(items, [{ x, y: 0.2, w: 0.44 - x + 0.001, h: 0.02 }]), 'traveller');
});

test('a selection begun outside the text layer: rects off the text give nothing', () => {
  assert.equal(quoteFromTextItems(items, [{ x: 0.6, y: 0.5, w: 0.2, h: 0.05 }]), '');
});

test('repair: rebuilt first, then stripped, then flagged; clean quotes untouched', () => {
  const themes = ['Key Concepts', 'Questions', 'Metaphors'];
  assert.equal(repairQuote('I met a traveller', 'anything', themes), null);
  assert.deepEqual(repairQuote(POLLUTED, 'I met a traveller from an antique land', themes), { quote: 'I met a traveller from an antique land' });
  assert.deepEqual(repairQuote(POLLUTED, '', themes), { quote: 'I met a traveller from an antique land' });
  assert.deepEqual(repairQuote('Marginalia • Annotator SEARCH THEME', null, themes), { needsReview: true });
});
