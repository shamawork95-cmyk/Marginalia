/**
 * The theme new marks are filed under must be one of the reader's themes.
 *
 * A document can open before the saved settings have loaded (the app reopening straight into it):
 * its tools then start on the default themes, and kept that theme's id after the real themes
 * arrived. Marks made then pointed at a theme that did not exist: untagged, and missing from My
 * Margins Tracker. Deleting the active theme in Settings did the same. Now the active theme moves
 * to the first theme whenever it is not in the list.
 */

import { useEffect } from 'react';

type Theme = { id: string };

/** The active theme id to use: kept when it is still a theme (or none was chosen), else the first. */
export function knownThemeId(active: string | null, themes: Theme[]): string | null {
  if (active === null || themes.some((t) => t.id === active)) return active;
  return themes[0]?.id ?? null;
}

/** Keeps `active` pointing at a real theme as the themes change. */
export function useKnownTheme(active: string | null, setActive: (id: string | null) => void, themes: Theme[]): void {
  useEffect(() => {
    const next = knownThemeId(active, themes);
    if (next !== active) setActive(next);
  }, [active, setActive, themes]);
}
