/**
 * Run with: npx tsx --test src/utils/findInDocument.test.ts
 *
 * Find in document (Cmd+F): every hit, in reading order, with offsets into the ORIGINAL text so
 * the reader can scroll to and highlight it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findInParagraphs, findInPages } from './findInDocument';

const at = (text: string, word: string, from = 0) => {
  const start = text.indexOf(word, from);
  return { start, end: start + word.length };
};

test('finds every hit in reading order with paragraph anchors', () => {
  const paras = ['The cat sat.', 'No match here.', 'cat and cat'];
  assert.deepEqual(findInParagraphs(paras, 'cat'), [
    { paragraphIndex: 0, ...at(paras[0], 'cat') },
    { paragraphIndex: 2, ...at(paras[2], 'cat') },
    { paragraphIndex: 2, ...at(paras[2], 'cat', 1) }
  ]);
});

test('ignores case by default; matchCase makes it exact', () => {
  const paras = ['Cat CAT cat'];
  assert.equal(findInParagraphs(paras, 'cat').length, 3);
  assert.deepEqual(findInParagraphs(paras, 'cat', { matchCase: true }), [{ paragraphIndex: 0, start: 8, end: 11 }]);
});

test('ignores diacritics by default, offsets still point at the original characters', () => {
  const para = 'Un café, and a cafe.';
  const hits = findInParagraphs([para], 'cafe');
  assert.deepEqual(hits, [
    { paragraphIndex: 0, ...at(para, 'café') },
    { paragraphIndex: 0, ...at(para, 'cafe', 10) }
  ]);
  assert.equal(findInParagraphs([para], 'café').length, 2, 'an accented query matches both too');
  assert.equal(findInParagraphs([para], 'cafe', { matchDiacritics: true }).length, 1);
});

test('decomposed accents (e + combining mark) map back to the whole original character', () => {
  const para = 'café noir';
  assert.deepEqual(findInParagraphs([para], 'café'), [{ paragraphIndex: 0, start: 0, end: 5 }]);
});

test('wholeWord skips matches inside longer words', () => {
  const para = 'cat category bobcat cat.';
  const hits = findInParagraphs([para], 'cat', { wholeWord: true });
  assert.deepEqual(hits, [
    { paragraphIndex: 0, start: 0, end: 3 },
    { paragraphIndex: 0, start: 20, end: 23 }
  ]);
});

test('empty or blank query finds nothing', () => {
  assert.deepEqual(findInParagraphs(['abc'], ''), []);
  assert.deepEqual(findInParagraphs(['abc'], '   '), []);
});

test('hits do not overlap', () => {
  assert.deepEqual(
    findInParagraphs(['aaaa'], 'aa').map((h) => h.start),
    [0, 2]
  );
});

test('PDF pages: 1-based page with offsets into that page\'s text-layer string', () => {
  const pages = ['First page text', 'second Page'];
  assert.deepEqual(findInPages(pages, 'page'), [
    { page: 1, start: 6, end: 10 },
    { page: 2, start: 7, end: 11 }
  ]);
});

test('fast on 3,000 paragraphs', () => {
  const para = 'Il était une fois, dans un royaume lointain, une reine qui lisait beaucoup de livres anciens. '.repeat(3);
  const paras = Array.from({ length: 3000 }, (_, i) => (i % 2 ? para : para.normalize('NFD')));
  // The fastest of three runs: the full suite runs files in parallel, and one slow run on a busy
  // machine says nothing about the search itself.
  let ms = Infinity;
  let hits: ReturnType<typeof findInParagraphs> = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    hits = findInParagraphs(paras, 'etait');
    ms = Math.min(ms, performance.now() - t0);
  }
  assert.equal(hits.length, 9000);
  assert.ok(ms < 250, `took ${ms.toFixed(0)} ms`);
});
