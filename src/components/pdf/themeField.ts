/**
 * The "+ New theme" field that is open right now, if any (at most one: it lives in the selection
 * menu). Pressing Highlight, Underline, Strikeout or Terminology while it holds a name creates that
 * theme first and marks the passage with it, rather than marking under the old theme and throwing
 * the typed name away. Pure, so it is tested.
 */

export interface CreatedTheme {
  id: string;
  color: string;
}

type Commit = () => CreatedTheme | null;

let open: Commit | null = null;

/** Called by the field on mount; returns the unregister to call on unmount. */
export function registerThemeField(commit: Commit): () => void {
  open = commit;
  return () => {
    if (open === commit) open = null;
  };
}

/**
 * Creates the theme the open field holds (when it has a valid name) and closes the field.
 * The new theme to mark with, or null: no field, an empty name, or a name the store refused.
 */
export function commitOpenThemeField(): CreatedTheme | null {
  return open ? open() : null;
}
