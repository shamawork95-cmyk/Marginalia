/**
 * Where the theme manager (Settings) and the pop-over's "+ New theme" read and write themes.
 *
 * One small interface, so both edit points share the same rules and the storage behind them can
 * change in one place. `localThemeStore` keeps the list where it has always lived,
 * `UserSettings.activeThemes`, saved to disk with the rest of the settings.
 */

import type { UserSettings } from '../types';
import { createTheme, deleteTheme, recolorTheme, renameTheme, type ThemeResult as SharedResult } from '../utils/themes';
import { distinctThemeColor } from '../utils/themeColors';

export type Theme = UserSettings['activeThemes'][number];
export type ThemeResult = { ok: true; theme: Theme } | { ok: false; error: string };

export interface ThemeStore {
  themes: Theme[];
  create: (name: string, color: string) => ThemeResult;
  rename: (id: string, name: string) => ThemeResult;
  recolor: (id: string, color: string) => ThemeResult;
  /** False when it cannot go: the last theme always stays (an empty list is refilled with the defaults). */
  remove: (id: string) => boolean;
}

/** The recolour palette: the app's existing theme colours, three moods of eight. */
export const THEME_COLOR_PALETTES = {
  mindful: [
    { name: 'Warm Terracotta', hex: '#e06d53' },
    { name: 'Golden Ochre', hex: '#d97706' },
    { name: 'Sage Leaf', hex: '#52796f' },
    { name: 'Deep Spruce', hex: '#2d6a4f' },
    { name: 'Oxford Slate', hex: '#3b5a70' },
    { name: 'Plum Velvet', hex: '#7209b7' },
    { name: 'Cedar Red', hex: '#bc4749' },
    { name: 'Dusty Indigo', hex: '#5e60ce' }
  ],
  vibrant: [
    { name: 'Rose Blossom', hex: '#f43f5e' },
    { name: 'Sky Azure', hex: '#0284c7' },
    { name: 'Emerald Forest', hex: '#059669' },
    { name: 'Royal Violet', hex: '#7c3aed' },
    { name: 'Amber Sun', hex: '#d97706' },
    { name: 'Teal Ocean', hex: '#0d9488' },
    { name: 'Crimson Wine', hex: '#be123c' },
    { name: 'Iris Blue', hex: '#4f46e5' }
  ],
  soft: [
    { name: 'Soft Coral', hex: '#f87171' },
    { name: 'Mint Herb', hex: '#4ade80' },
    { name: 'Sky Blue', hex: '#38bdf8' },
    { name: 'Lilac Bloom', hex: '#c084fc' },
    { name: 'Buttercup', hex: '#fbbf24' },
    { name: 'Peach Blush', hex: '#fb923c' },
    { name: 'Seafoam Teal', hex: '#2dd4bf' },
    { name: 'Lavender', hex: '#a78bfa' }
  ]
};
export type PaletteName = keyof typeof THEME_COLOR_PALETTES;

/**
 * The colour a new theme starts on: never close to one the reader already has (see
 * utils/themeColors.ts). A palette colour while one is far enough from them all, then a generated one.
 */
export function nextFreeColor(themes: Theme[]): string {
  const palette = [...new Set(Object.values(THEME_COLOR_PALETTES).flat().map((c) => c.hex.toLowerCase()))];
  return distinctThemeColor(themes.map((t) => t.color), palette);
}

/**
 * The store over `UserSettings.activeThemes`, using the shared rules in `utils/themes`. `update` is
 * the app's settings setter (saved to disk with the rest of the settings); each edit is checked
 * against the list shown, then re-applied to the latest settings it hands back, so two quick
 * edits never overwrite each other.
 */
export function localThemeStore(
  themes: Theme[],
  update: (fn: (prev: UserSettings) => UserSettings) => void,
  newId: () => string = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
): ThemeStore {
  const apply = (op: (list: Theme[]) => SharedResult): ThemeResult => {
    const r = op(themes);
    if ('error' in r) return { ok: false, error: r.error };
    update((prev) => {
      const again = op(prev.activeThemes);
      return 'error' in again ? prev : { ...prev, activeThemes: again.themes };
    });
    return { ok: true, theme: r.theme };
  };
  return {
    themes,
    create(name, color) {
      const id = newId();
      return apply((list) => createTheme(list, { name, color }, () => id));
    },
    rename: (id, name) => apply((list) => renameTheme(list, id, name)),
    recolor: (id, color) => apply((list) => recolorTheme(list, id, color)),
    remove(id) {
      if (themes.length <= 1 || !themes.some((t) => t.id === id)) return false;
      update((prev) => ({ ...prev, activeThemes: deleteTheme(prev.activeThemes, id) }));
      return true;
    }
  };
}
