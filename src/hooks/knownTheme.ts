/**
 * The themes new marks are filed under must be among the reader's themes.
 *
 * A document can open before the saved settings have loaded (the app reopening straight into it):
 * its tools then start on the default themes, and kept that theme's id after the real themes
 * arrived. Marks made then pointed at a theme that did not exist: untagged, and missing from My
 * Margins Tracker. Deleting the active theme in Settings did the same. Now unknown ids are dropped,
 * and when none is left the first theme takes over.
 */

import { useEffect } from 'react';

type Theme = { id: string };

/** The active themes to use: the known ones, else the first theme. "No theme" (empty) stays empty. */
export function knownThemeIds(active: readonly string[], themes: Theme[]): string[] {
  const known = active.filter((id) => themes.some((t) => t.id === id));
  if (known.length === active.length) return [...active];
  if (known.length) return known;
  return themes[0] ? [themes[0].id] : [];
}

/** Keeps `active` pointing at real themes as the themes change. */
export function useKnownThemes(active: string[], setActive: (ids: string[]) => void, themes: Theme[]): void {
  useEffect(() => {
    const next = knownThemeIds(active, themes);
    if (next.join('\n') !== active.join('\n')) setActive(next);
  }, [active, setActive, themes]);
}
