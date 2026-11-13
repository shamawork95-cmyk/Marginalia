/**
 * Run with: npx tsx --test src/hooks/knownTheme.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownThemeId } from './knownTheme';

const themes = [{ id: 'love' }, { id: 'ruin' }];

test('a theme still in the list is kept; "no theme" stays no theme', () => {
  assert.equal(knownThemeId('ruin', themes), 'ruin');
  assert.equal(knownThemeId(null, themes), null);
});

test('a default theme left over from before the settings loaded moves to the first real theme', () => {
  assert.equal(knownThemeId('1', themes), 'love');
});

test('with no themes at all, marks are filed under none', () => {
  assert.equal(knownThemeId('love', []), null);
});
