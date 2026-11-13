/**
 * Run with: npx tsx --test src/hooks/knownTheme.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownThemeIds } from './knownTheme';

const themes = [{ id: 'love' }, { id: 'ruin' }];

test('themes still in the list are kept; "no theme" stays no theme', () => {
  assert.deepEqual(knownThemeIds(['ruin', 'love'], themes), ['ruin', 'love']);
  assert.deepEqual(knownThemeIds([], themes), []);
});

test('a deleted theme is dropped and the others kept', () => {
  assert.deepEqual(knownThemeIds(['gone', 'ruin'], themes), ['ruin']);
});

test('a default theme left over from before the settings loaded moves to the first real theme', () => {
  assert.deepEqual(knownThemeIds(['1'], themes), ['love']);
});

test('with no themes at all, marks are filed under none', () => {
  assert.deepEqual(knownThemeIds(['love'], []), []);
});
