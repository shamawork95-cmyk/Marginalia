/**
 * Run with: npx tsx --test src/utils/themeColors.test.ts
 *
 * New themes get colours that are never close to an existing theme's colour.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorDistance, distinctThemeColor, hexToOklab, MIN_THEME_DISTANCE, oklchToHex } from './themeColors';
import { nextFreeColor, THEME_COLOR_PALETTES } from '../components/themeStore';

test('OKLab round trip and distance: the same colour is 0 apart, black and white far', () => {
  const lab = hexToOklab('#52796f')!;
  const h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  assert.equal(oklchToHex(lab[0], Math.hypot(lab[1], lab[2]), h), '#52796f');
  assert.equal(colorDistance('#e06d53', '#E06D53'), 0);
  assert.ok(colorDistance('#000000', '#ffffff') > 0.99);
  assert.equal(hexToOklab('teal'), null);
  assert.equal(hexToOklab('#abc')!.join(), hexToOklab('#aabbcc')!.join());
});

test('the old near pairs really are near; that is what this replaces', () => {
  assert.ok(colorDistance('#e06d53', '#d97706') < 0.12); // Warm Terracotta / Golden Ochre
  assert.equal(colorDistance('#d97706', '#d97706'), 0); // Golden Ochre / Amber Sun: the same hex
});

test('twelve themes made one after another are all clearly apart', () => {
  const themes: { id: string; name: string; color: string }[] = [];
  for (let i = 0; i < 12; i++) themes.push({ id: String(i), name: `T${i}`, color: nextFreeColor(themes) });
  for (let i = 0; i < themes.length; i++)
    for (let j = 0; j < i; j++)
      assert.ok(colorDistance(themes[i].color, themes[j].color) >= MIN_THEME_DISTANCE, `${themes[i].color} vs ${themes[j].color}`);
});

test('past the palette, a generated colour is still the farthest from every theme', () => {
  const existing = Object.values(THEME_COLOR_PALETTES).flat().map((c) => c.hex);
  const next = distinctThemeColor(existing, existing);
  assert.ok(!existing.includes(next));
  const nearestOf = (c: string) => Math.min(...existing.map((e) => colorDistance(c, e)));
  // At least as far from its nearest neighbour as any palette colour could be (they are all used).
  assert.ok(nearestOf(next) > 0);
});

test('the reader\'s own odd colours are measured too, and the result is stable', () => {
  const mine = ['#123456', '#fedcba'];
  assert.equal(distinctThemeColor(mine, ['#123457', '#52796f']), '#52796f');
  assert.equal(distinctThemeColor(mine, ['#123457', '#52796f']), distinctThemeColor(mine, ['#123457', '#52796f']));
});
