/**
 * Run with: npx tsx --test src/components/readingModes.test.ts
 *
 * The pure parts of 2.6.0's reading modes: spread paging (`pageTurn.ts`), focus mode's toolbar
 * rule, the tour's step moves, and the theme store's rules.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampSpread, columnAt, pageCountFor, turnDirection } from './pageTurn';
import { chromeShown } from './FocusMode';
import { stepAfter, TUTORIAL_STEPS } from './Tutorial';
import { localThemeStore, nextFreeColor, THEME_COLOR_PALETTES, type Theme } from './themeStore';
import { colorDistance, MIN_THEME_DISTANCE } from '../utils/themeColors';
import type { UserSettings } from '../types';

test('spread paging: page count, column of a box, turn direction, clamping', () => {
  // 556px pages, 100px gap: a flow 22150 wide holds 40 pages.
  assert.equal(pageCountFor(22150, 556, 100), 40);
  assert.equal(pageCountFor(1012, 556, 100), 2);
  assert.equal(pageCountFor(0, 556, 100), 1);
  assert.equal(pageCountFor(500, 0, 0), 1);
  // A box centred in the gap's left half still belongs to the column it sticks out of.
  assert.equal(columnAt(324 + 238, 324, 556), 0);
  assert.equal(columnAt(324 + 556 + 10, 324, 556), 1);
  assert.equal(columnAt(100, 324, 556), 0);
  assert.equal(turnDirection(2, 3), 1);
  assert.equal(turnDirection(3, 0), -1);
  assert.equal(turnDirection(1, 1), null);
  assert.equal(clampSpread(-1, 5), 0);
  assert.equal(clampSpread(9, 5), 4);
  assert.equal(clampSpread(2.7, 5), 2);
  assert.equal(clampSpread(3, 0), 0);
});

test('focus mode shows the toolbar only when called for', () => {
  const base = { focus: true, selecting: false, nearTop: false, focusWithin: false };
  assert.equal(chromeShown({ ...base, focus: false }), true);
  assert.equal(chromeShown(base), false);
  assert.equal(chromeShown({ ...base, selecting: true }), true);
  assert.equal(chromeShown({ ...base, nearTop: true }), true);
  assert.equal(chromeShown({ ...base, focusWithin: true }), true);
});

test('tour steps: 4 to 6 steps, forward past the end finishes, back stops at the start', () => {
  assert.ok(TUTORIAL_STEPS.length >= 4 && TUTORIAL_STEPS.length <= 6);
  assert.equal(stepAfter(0, -1, 5), 0);
  assert.equal(stepAfter(0, 1, 5), 1);
  assert.equal(stepAfter(4, 1, 5), 'done');
  assert.equal(stepAfter(3, -1, 5), 2);
});

/** A store over a settings object, with `update` applied at once like a state setter would. */
function harness(themes: Theme[]) {
  let settings = { activeThemes: themes } as UserSettings;
  let n = 0;
  const store = () =>
    localThemeStore(settings.activeThemes, (fn) => (settings = fn(settings)), () => `id${++n}`);
  return { store, get themes() { return settings.activeThemes; } };
}

test('theme store: create, rename, recolour, delete, with the same rules everywhere', () => {
  const h = harness([{ id: 'a', name: 'Key Concepts', color: '#52796f' }]);
  const made = h.store().create('  Memory ', '#E06D53');
  assert.ok('theme' in made && made.theme.name === 'Memory' && made.theme.color === '#e06d53');
  assert.equal(h.themes.length, 2);

  const dup = h.store().create('memory', '#5e60ce');
  assert.ok('error' in dup && /already exists/.test(dup.error));
  assert.ok('error' in h.store().create('   ', '#5e60ce'));
  assert.ok('error' in h.store().create('Ethics', 'teal'));
  assert.ok('error' in h.store().create('x'.repeat(61), '#5e60ce'));
  assert.equal(h.themes.length, 2);

  // Renaming to its own name in another case is fine; to another theme's name is not.
  assert.ok('theme' in h.store().rename('id1', 'MEMORY'));
  assert.ok('error' in h.store().rename('id1', 'key concepts'));
  assert.ok('error' in h.store().rename('gone', 'X'));
  assert.ok('theme' in h.store().recolor('a', '#3B5A70'));
  assert.equal(h.themes.find((t) => t.id === 'a')!.color, '#3b5a70');

  assert.equal(h.store().remove('id1'), true);
  // The last theme stays.
  assert.equal(h.store().remove('a'), false);
  assert.deepEqual(h.themes.map((t) => t.id), ['a']);
});

test('theme store helpers', () => {
  const first = THEME_COLOR_PALETTES.mindful[0].hex;
  assert.equal(nextFreeColor([]), first);
  // Not the next palette colour (Golden Ochre sits too close to Warm Terracotta): the farthest one.
  const second = nextFreeColor([{ id: '1', name: 'A', color: first.toUpperCase() }]);
  assert.notEqual(second, THEME_COLOR_PALETTES.mindful[1].hex);
  assert.ok(colorDistance(second, first) >= MIN_THEME_DISTANCE);
});
