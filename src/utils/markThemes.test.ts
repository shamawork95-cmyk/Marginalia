/**
 * Run with: npx tsx --test src/utils/markThemes.test.ts
 *
 * Several themes per mark: reading any older shape, writing the older field back for older
 * versions, and toggling themes on a mark.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addThemeId,
  colorForThemes,
  hasTheme,
  isOldThemeShape,
  mainThemeId,
  pickTheme,
  readAllThemes,
  readThemes,
  themeIdsOf,
  toggleThemeId,
  unionThemeIds,
  writeAllThemes,
  writeThemes
} from './markThemes';

test('an older mark with one theme reads as a list of one; untagged or missing as none', () => {
  assert.deepEqual(themeIdsOf({ themeId: 'love' }), ['love']);
  assert.deepEqual(themeIdsOf({ themeId: null }), []);
  assert.deepEqual(themeIdsOf({}), []);
  assert.deepEqual(themeIdsOf(null), []);
});

test('the list wins over the older field, without blanks or repeats, order kept', () => {
  assert.deepEqual(themeIdsOf({ themeIds: ['ruin', '', 'love', 'ruin', 7], themeId: 'other' }), ['ruin', 'love']);
  assert.equal(mainThemeId({ themeIds: ['ruin', 'love'] }), 'ruin');
  assert.equal(mainThemeId({ themeIds: [] }), null);
  assert.equal(hasTheme({ themeIds: ['ruin', 'love'] }, 'love'), true);
  assert.equal(hasTheme({ themeId: 'love' }, 'love'), true);
});

test('reading drops the older field and keeps everything else as it was', () => {
  const old = { id: 'a', page: 2, kind: 'highlight', themeId: 'love', quote: 'words', extra: { kept: true } };
  assert.deepEqual(readThemes(old), { id: 'a', page: 2, kind: 'highlight', quote: 'words', extra: { kept: true }, themeIds: ['love'] });
  assert.deepEqual(readAllThemes<unknown>([old, 'not an object', null]), [readThemes(old), 'not an object', null]);
});

test('writing keeps the older field as the main theme, for older versions', () => {
  assert.deepEqual(writeThemes({ id: 'a', themeIds: ['ruin', 'love'] }), { id: 'a', themeIds: ['ruin', 'love'], themeId: 'ruin' });
  assert.deepEqual(writeThemes({ id: 'b', themeIds: [] }), { id: 'b', themeIds: [], themeId: null });
  // Round trip: what is written reads back the same.
  const marks = [{ id: 'a', themeIds: ['ruin', 'love'] }, { id: 'b', themeIds: [] }];
  assert.deepEqual(readAllThemes(writeAllThemes(marks)), marks);
});

test('a record is in the old shape until every mark has a list', () => {
  assert.equal(isOldThemeShape({ id: 'a', themeId: 'love' }), true);
  assert.equal(isOldThemeShape({ id: 'a' }), true);
  assert.equal(isOldThemeShape({ id: 'a', themeIds: [], themeId: null }), false);
});

test('toggling a theme on and off keeps the main theme first; adding never repeats', () => {
  assert.deepEqual(toggleThemeId(['love'], 'ruin'), ['love', 'ruin']);
  assert.deepEqual(toggleThemeId(['love', 'ruin'], 'love'), ['ruin']);
  assert.deepEqual(addThemeId(['love'], 'love'), ['love']);
  assert.deepEqual(addThemeId(['love'], null), ['love']);
  assert.deepEqual(unionThemeIds(['love'], ['ruin', 'love', 'time']), ['love', 'ruin', 'time']);
});

test('picking in the mark editor: a theme toggles and the colour follows the main theme; a plain colour clears themes', () => {
  const themes = [
    { id: 'love', color: '#b5527a' },
    { id: 'ruin', color: '#3f6fb5' }
  ];
  assert.deepEqual(pickTheme(['love'], 'ruin', '#3f6fb5', themes), { themeIds: ['love', 'ruin'], color: '#b5527a' });
  assert.deepEqual(pickTheme(['love', 'ruin'], 'love', '#b5527a', themes), { themeIds: ['ruin'], color: '#3f6fb5' });
  assert.deepEqual(pickTheme(['love'], null, '#222222', themes), { themeIds: [], color: '#222222' });
  // The last theme off: no theme, and the mark keeps the colour it had.
  assert.deepEqual(pickTheme(['love'], 'love', '#b5527a', themes), { themeIds: [], color: '#b5527a' });
  assert.equal(colorForThemes(['gone'], themes, '#123456'), '#123456');
});

test('the dots of a mark under several themes: one per theme after the main, up to three, then "+n"', async () => {
  const { extraThemeDots } = await import('./markThemes');
  const themes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id.toUpperCase(), color: `#${id.repeat(6)}` }));
  assert.deepEqual(extraThemeDots(['a'], themes), { dots: [], more: 0, label: '' });
  const two = extraThemeDots(['a', 'b', 'gone'], themes);
  assert.deepEqual(two.dots.map((d) => [d.id, d.name]), [['b', 'B'], ['gone', 'Untitled']]);
  assert.equal(two.label, 'Also filed under B, Untitled');
  const many = extraThemeDots(['a', 'b', 'c', 'd', 'e'], themes);
  assert.deepEqual([many.dots.length, many.more], [3, 1]);
});
