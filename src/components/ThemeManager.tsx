/**
 * Settings → Themes: every theme as a colour swatch and a name, with create, rename, recolour and
 * delete (confirmed). Works through a `ThemeStore`, the same one the pop-over's "+ New theme" uses.
 */

import React, { useEffect, useState } from 'react';
import { listStoredDocuments } from '../utils/documentStorage';
import { themeUsage } from '../utils/themes';
import { plural } from '../utils/plural';
import { Check, Palette, Plus, Sparkles, Trash2 } from './icons';
import { THEME_COLOR_PALETTES, nextFreeColor, type PaletteName, type ThemeStore } from './themeStore';

const PALETTES = Object.keys(THEME_COLOR_PALETTES) as PaletteName[];

/** The palette: three moods of the app's theme colours, plus the free picker. */
export const PalettePicker: React.FC<{ value: string; onPick: (hex: string) => void; label: string }> = ({ value, onPick, label }) => {
  const [tab, setTab] = useState<PaletteName>(
    () => PALETTES.find((p) => THEME_COLOR_PALETTES[p].some((c) => c.hex.toLowerCase() === value.toLowerCase())) ?? 'mindful'
  );
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label={`${label} palettes`} className="flex-1 flex items-center gap-1 p-0.5 bg-black/5 dark:bg-white/5 rounded-full text-[11px]">
          {PALETTES.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={tab === p}
              onClick={() => setTab(p)}
              className={`flex-1 py-1 rounded-full capitalize font-medium transition-colors cursor-pointer ${
                tab === p
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-paper shadow-2xs font-semibold'
                  : 'text-muted hover:text-stone-800 dark:hover:text-stone-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <label
          title="Any colour"
          className="relative w-7 h-7 shrink-0 rounded-full border border-black/10 dark:border-white/20 cursor-pointer overflow-hidden focus-within:ring-2 focus-within:ring-gold"
          style={{ background: 'conic-gradient(#e06d53, #d97706, #52796f, #3b5a70, #5e60ce, #7209b7, #e06d53)' }}
        >
          <span className="sr-only">Any colour</span>
          <input type="color" value={value} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
      </div>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-1.5">
        {THEME_COLOR_PALETTES[tab].map((c) => {
          const on = value.toLowerCase() === c.hex.toLowerCase();
          return (
            <button
              key={c.hex}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(c.hex)}
              className={`flex flex-col items-center gap-1 p-1.5 rounded-xl border transition-colors cursor-pointer ${
                on ? 'border-gold bg-gold/10' : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <span className="w-5 h-5 rounded-full flex items-center justify-center border border-black/10" style={{ backgroundColor: c.hex }}>
                {on && <Check className="w-3 h-3 text-white" weight="bold" />}
              </span>
              <span className="text-[10px] text-stone-700 dark:text-stone-300 truncate max-w-full">{c.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

type Mode = { kind: 'idle' } | { kind: 'recolor' | 'rename' | 'delete'; id: string } | { kind: 'create' };

export const ThemeManager: React.FC<{ store: ThemeStore; isDark: boolean }> = ({ store, isDark }) => {
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [draft, setDraft] = useState('');
  const [draftColor, setDraftColor] = useState('#52796f');
  const [error, setError] = useState<string | null>(null);
  const only = store.themes.length <= 1;
  /** How many marks across the library sit under the theme being deleted (read when asked). */
  const [usage, setUsage] = useState<number | null>(null);
  const deletingId = mode.kind === 'delete' ? mode.id : null;
  useEffect(() => {
    setUsage(null);
    if (!deletingId) return;
    let cancelled = false;
    void listStoredDocuments().then((metas) => !cancelled && setUsage(themeUsage(metas, deletingId)));
    return () => {
      cancelled = true;
    };
  }, [deletingId]);

  const open = (next: Mode, name = '', color = '') => {
    setMode(next);
    setDraft(name);
    if (color) setDraftColor(color);
    setError(null);
  };
  const close = () => open({ kind: 'idle' });
  const commitRename = (id: string) => {
    const current = store.themes.find((t) => t.id === id);
    if (!current || draft.trim() === current.name) return close();
    const r = store.rename(id, draft);
    if ('error' in r) setError(r.error);
    else close();
  };
  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const r = store.create(draft, draftColor);
    if ('error' in r) setError(r.error);
    else close();
  };

  const field = `w-full border rounded-xl px-3 py-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-gold ${
    isDark ? 'bg-night-5 border-stone-700 text-paper placeholder:text-stone-400' : 'bg-stone-50 border-stone-300 text-stone-900 placeholder:text-stone-500'
  }`;
  const iconBtn = 'p-1.5 rounded-lg text-muted hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer';

  return (
    <section
      id="settings-active-themes-section"
      aria-labelledby="theme-manager-title"
      className={`p-5 rounded-2xl border ${isDark ? 'bg-night-3 border-stone-800 text-stone-100' : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 id="theme-manager-title" className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-muted" />
          <span className="caps spine-type text-muted">Themes</span>
        </h3>
        <button
          type="button"
          onClick={() => open({ kind: 'create' }, '', nextFreeColor(store.themes))}
          disabled={mode.kind === 'create'}
          className="rounded-full caps spine-type caps-sm px-3 py-1.5 flex items-center gap-1 text-gold dark:text-gold hover:bg-gold/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          <Plus className="w-3.5 h-3.5" />
          New theme
        </button>
      </div>

      <ul className="space-y-2">
        {store.themes.map((theme) => {
          const recoloring = mode.kind === 'recolor' && mode.id === theme.id;
          const renaming = mode.kind === 'rename' && mode.id === theme.id;
          const deleting = mode.kind === 'delete' && mode.id === theme.id;
          return (
            <li
              key={theme.id}
              className={`rounded-xl border transition-colors ${
                recoloring || deleting
                  ? isDark
                    ? 'bg-night-4 border-gold'
                    : 'bg-paper-2 border-gold'
                  : isDark
                    ? 'bg-night-1 border-stone-800/80'
                    : 'bg-stone-50 border-stone-200/80'
              }`}
            >
              <div className="flex items-center gap-3 p-2">
                <button
                  type="button"
                  onClick={() => (recoloring ? close() : open({ kind: 'recolor', id: theme.id }))}
                  aria-label={`Change the colour of ${theme.name}`}
                  aria-expanded={recoloring}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full cursor-pointer group"
                >
                  <span
                    className="w-5 h-5 rounded-full border border-black/10 dark:border-white/25 transition-transform duration-150 ease-out group-hover:scale-110"
                    style={{ backgroundColor: theme.color }}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  {renaming ? (
                    <input
                      autoFocus
                      value={draft}
                      aria-label={`Rename ${theme.name}`}
                      aria-invalid={Boolean(error)}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setError(null);
                      }}
                      onBlur={() => commitRename(theme.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(theme.id);
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          close();
                        }
                      }}
                      className={field}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => open({ kind: 'rename', id: theme.id }, theme.name)}
                      title="Rename"
                      className="block max-w-full truncate text-left text-[14px] font-medium cursor-text hover:underline decoration-dotted underline-offset-4"
                    >
                      {theme.name}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => (recoloring ? close() : open({ kind: 'recolor', id: theme.id }))}
                  aria-label={`Recolour ${theme.name}`}
                  title="Recolour"
                  className={`${iconBtn} ${recoloring ? 'text-gold dark:text-gold' : ''}`}
                >
                  <Palette className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => open({ kind: 'delete', id: theme.id })}
                  disabled={only}
                  aria-label={`Delete ${theme.name}`}
                  title={only ? 'At least one theme is needed' : 'Delete'}
                  className={`${iconBtn} hover:text-red-600 dark:hover:text-red-300 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {renaming && error && (
                <p role="alert" className="px-3 pb-2 -mt-1 text-[12px] text-red-700 dark:text-red-300">
                  {error}
                </p>
              )}

              {recoloring && (
                <div className="px-3 pb-3 pt-1 border-t border-stone-200 dark:border-stone-700/60">
                  <div className="flex items-center justify-between py-2">
                    <span className="caps spine-type caps-sm text-muted">Colour for {theme.name}</span>
                    <button type="button" onClick={close} className="rounded-full caps spine-type caps-sm px-3 py-1 text-muted hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                      Done
                    </button>
                  </div>
                  <PalettePicker value={theme.color} onPick={(hex) => store.recolor(theme.id, hex)} label={`Colour for ${theme.name}`} />
                </div>
              )}

              {deleting && (
                <div role="alertdialog" aria-label={`Delete ${theme.name}?`} className="px-3 pb-3 pt-2 border-t border-stone-200 dark:border-stone-700/60 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] text-muted">
                    Delete <span className="font-semibold text-ink dark:text-paper">{theme.name}</span>?{' '}
                    {usage
                      ? `${plural(usage, 'mark')} across My Collections ${usage === 1 ? 'is' : 'are'} filed under it. They keep their colour and show as Untitled.`
                      : 'Marks filed under it keep their colour.'}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button type="button" autoFocus onClick={close} className="rounded-full caps spine-type caps-sm px-3 py-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        store.remove(theme.id);
                        close();
                      }}
                      className="rounded-full caps spine-type caps-sm px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white dark:bg-red-300 dark:hover:bg-red-200 dark:text-stone-900 cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {mode.kind === 'create' && (
        <form onSubmit={submitCreate} className="mt-4 pt-4 border-t border-stone-200 dark:border-stone-700/60 space-y-3">
          <label className="block space-y-1">
            <span className="caps spine-type caps-sm text-muted">New theme name</span>
            <input
              autoFocus
              value={draft}
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  close();
                }
              }}
              placeholder="e.g. Ethics, Memory, Open questions"
              className={field}
            />
          </label>
          {error && (
            <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          <PalettePicker value={draftColor} onPick={setDraftColor} label="New theme colour" />
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={close} className="rounded-full caps spine-type px-4 py-2 text-[12px] text-muted hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
              Cancel
            </button>
            <button type="submit" className="rounded-full caps spine-type px-4 py-2 text-[12px] bg-accent hover:bg-accent-hover text-on-accent flex items-center gap-1.5 cursor-pointer">
              <span className="w-2.5 h-2.5 rounded-full border border-white/40" style={{ backgroundColor: draftColor }} />
              Create theme
            </button>
          </div>
        </form>
      )}
    </section>
  );
};
