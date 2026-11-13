/**
 * Several themes per mark (3.0 format).
 *
 * Every mark, sticky note and text mark now stores `themeIds: string[]`: the themes it is filed
 * under, the first being its main theme (its colour). Older records hold a single
 * `themeId: string | null` instead. The rules, in one place:
 *
 * - Reading: `themeIds` wins when it is an array; otherwise `themeId` becomes `[themeId]`, or `[]`
 *   when it is null or missing. The app itself never sees `themeId` again.
 * - Writing to disk: `themeId` is written too, as the first theme (or null), so an older copy of
 *   Marginalia (an unsigned Mac build, a student's class pack) still files the mark under its main
 *   theme. It simply does not see the others.
 * - Before the first write in the new format, the store keeps the old record once as
 *   `{id}.json.pre-themes` (see `LocalStorageBackend.write`).
 *
 * Pure: nothing here touches the disk.
 */

type Entry = Record<string, unknown>;

/** The themes an entry of any age is filed under: no blanks, no repeats, order kept. */
export function themeIdsOf(entry: object | null | undefined): string[] {
  if (!entry) return [];
  const e = entry as { themeIds?: unknown; themeId?: unknown };
  const source = Array.isArray(e.themeIds) ? e.themeIds : typeof e.themeId === 'string' ? [e.themeId] : [];
  const out: string[] = [];
  for (const id of source) if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
  return out;
}

/** The main theme (the mark's colour), or null when untagged. */
export function mainThemeId(entry: object | null | undefined): string | null {
  return themeIdsOf(entry)[0] ?? null;
}

/** Whether the entry is filed under `id`. */
export function hasTheme(entry: object | null | undefined, id: string): boolean {
  return themeIdsOf(entry).includes(id);
}

/** True when the entry still holds only the old single `themeId` (or no theme field at all). */
export function isOldThemeShape(entry: unknown): boolean {
  return Boolean(entry) && typeof entry === 'object' && !Array.isArray((entry as Entry).themeIds);
}

/** One entry in the in-app shape: `themeIds`, no `themeId`. Other fields are untouched. */
export function readThemes<T extends Entry>(entry: T): Omit<T, 'themeId'> & { themeIds: string[] } {
  const { themeId: _old, ...rest } = entry;
  return { ...rest, themeIds: themeIdsOf(entry) };
}

/** Every entry in the in-app shape. Anything that is not an object is passed through as it was. */
export function readAllThemes<T>(entries: T[]): T[] {
  return entries.map((e) => (e && typeof e === 'object' && !Array.isArray(e) ? (readThemes(e as Entry) as T) : e));
}

/** One entry as written to disk: `themeIds` plus the older `themeId` (its first theme). */
export function writeThemes<T extends Entry>(entry: T): T & { themeIds: string[]; themeId: string | null } {
  const themeIds = themeIdsOf(entry);
  return { ...entry, themeIds, themeId: themeIds[0] ?? null };
}

/** Every entry as written to disk. */
export function writeAllThemes<T>(entries: T[]): T[] {
  return entries.map((e) => (e && typeof e === 'object' && !Array.isArray(e) ? (writeThemes(e as Entry) as T) : e));
}

/** `ids` with `id` turned on or off. Turning on adds it at the end, so the main theme stays first. */
export function toggleThemeId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((t) => t !== id) : [...ids, id];
}

/** `ids` with `id` added at the end, unless it is already there. */
export function addThemeId(ids: readonly string[], id: string | null): string[] {
  return !id || ids.includes(id) ? [...ids] : [...ids, id];
}

/** The mark's colour after its themes change: the new main theme's colour, else the colour it had. */
export function colorForThemes(ids: readonly string[], themes: readonly { id: string; color: string }[], current: string): string {
  const main = ids[0] && themes.find((t) => t.id === ids[0]);
  return main ? main.color : current;
}

/** `ids` followed by any of `more` it does not hold yet. */
export function unionThemeIds(ids: readonly string[], more: readonly string[]): string[] {
  return more.reduce<string[]>((acc, id) => addThemeId(acc, id), [...ids]);
}

/**
 * A mark's themes and colour after a theme swatch or plain colour is picked in its editor, the marks
 * panel or with a number key. A theme toggles on or off (the colour follows the main theme); a plain
 * colour takes every theme off, as picking an "untagged colour" always has.
 */
export function pickTheme(
  current: readonly string[],
  themeId: string | null,
  color: string,
  themes: readonly { id: string; color: string }[]
): { themeIds: string[]; color: string } {
  if (!themeId) return { themeIds: [], color };
  const themeIds = toggleThemeId(current, themeId);
  return { themeIds, color: colorForThemes(themeIds, themes, color) };
}

/** At most this many dots for a mark's other themes; the rest are a "+n". */
export const MAX_THEME_DOTS = 3;

/**
 * The dots drawn before a mark under several themes: one per theme after the main one (which is
 * the mark's own colour), up to MAX_THEME_DOTS, and how many more there are. A deleted theme is a
 * grey dot named "Untitled", as everywhere else.
 */
export function extraThemeDots(
  themeIds: readonly string[] | undefined,
  themes: readonly { id: string; name: string; color: string }[]
): { dots: { id: string; name: string; color: string }[]; more: number; label: string } {
  const extra = (themeIds ?? []).slice(1).map((id) => themes.find((t) => t.id === id) ?? { id, name: 'Untitled', color: '#9a9a9a' });
  return {
    dots: extra.slice(0, MAX_THEME_DOTS),
    more: Math.max(0, extra.length - MAX_THEME_DOTS),
    label: extra.length ? `Also filed under ${extra.map((t) => t.name).join(', ')}` : ''
  };
}
