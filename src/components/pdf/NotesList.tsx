/**
 * Every mark in the document, grouped by theme.
 *
 * Grouping is exact rather than inferred: each mark stores its own `themeId`, so re-colouring a
 * mark or editing a theme's colour never re-files anything by accident. Hovering a row raises the
 * mark on the page; clicking scrolls to it.
 *
 * A search box and one chip per kind present narrow the list; within each theme the marks run in
 * reading order (page, then top to bottom, then left to right — see `notesFilter.ts`).
 */

import React, { useMemo, useState } from 'react';
import {
  StickyNote,
  Highlighter,
  Underline,
  Strikethrough,
  PenLine,
  Square,
  Circle,
  ArrowUpRight,
  Minus,
  Braces,
  Type,
  Trash2,
  Pencil,
  Search,
  X
} from '../icons';
import { Annotation, AnnotationKind } from './annotationModel';
import { UserSettings } from '../../types';
import { NOTE_KIND_LABELS, NoteFilterKind, presentKinds, visibleNotes } from './notesFilter';

/** A reaction's icon is the literal mark it stamps, not a lookalike glyph. */
const charIcon =
  (char: string): React.FC<{ className?: string }> =>
  ({ className }) => (
    <span className={`${className ?? ''} inline-flex items-center justify-center text-[13px] font-extrabold leading-none`}>
      {char}
    </span>
  );

const KIND_ICONS: Record<AnnotationKind, React.ElementType> = {
  highlight: Highlighter,
  underline: Underline,
  strikeout: Strikethrough,
  question: charIcon('?'),
  star: charIcon('*'),
  exclamation: charIcon('!'),
  ink: PenLine,
  note: StickyNote,
  rect: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
  line: Minus,
  bracket: Braces,
  text: Type
};

interface NotesListProps {
  annotations: Annotation[];
  settings: UserSettings;
  isDark?: boolean;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (annotation: Annotation) => void;
  onRetag: (id: string, themeId: string | null, color: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  /** Where a mark sits, under its words. Text documents say paragraph, not page. */
  locationLabel?: (annotation: Annotation) => string;
}

const pageLabel = (a: Annotation) => `Page ${a.page}`;

export const NotesList: React.FC<NotesListProps> = ({
  annotations,
  settings,
  isDark = false,
  hoveredId,
  onHover,
  onSelect,
  onRetag,
  onDelete,
  onEdit,
  locationLabel = pageLabel
}) => {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<NoteFilterKind | null>(null);
  const kinds = useMemo(() => presentKinds(annotations), [annotations]);
  // A chip whose last mark was deleted disappears; its filter must go with it.
  const activeKind = kind && kinds.includes(kind) ? kind : null;
  // Reading order within each theme: someone scanning this is walking the document front to back.
  const sorted = useMemo(() => visibleNotes(annotations, query, activeKind), [annotations, query, activeKind]);
  const filtering = query.trim() !== '' || activeKind !== null;
  const groups = [
    ...settings.activeThemes.map((theme) => ({
      id: theme.id as string | null,
      name: theme.name,
      color: theme.color,
      items: sorted.filter((a) => a.themeId === theme.id)
    })),
    {
      id: null,
      name: 'Untagged',
      color: '#a8a29e',
      // Everything no theme group claimed — not just `themeId === null`. A mark filed under a
      // theme the reader has since removed in Settings matched no group at all, so it vanished
      // from this panel while still being on the page, in the counts and in the export.
      items: sorted.filter((a) => !settings.activeThemes.some((t) => t.id === a.themeId))
    }
  ].filter((group) => group.items.length > 0);

  if (annotations.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-10 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
          <StickyNote className="w-6 h-6" />
        </div>
        <h3 className="title-hand text-[26px] text-stone-900 dark:text-paper">Nothing marked yet</h3>
        <p className="text-[12px] text-muted max-w-[15rem] mx-auto leading-relaxed">
          Pick a theme in the toolbar, then highlight a passage or drop a note. Everything you mark
          collects here, grouped by theme.
        </p>
      </div>
    );
  }

  const chip = (value: NoteFilterKind | null, label: string) => {
    const active = activeKind === value;
    return (
      <button
        key={value ?? 'all'}
        type="button"
        onClick={() => setKind(value)}
        aria-pressed={active}
        className={`caps caps-sm rounded-full px-2.5 py-1 whitespace-nowrap transition-colors cursor-pointer ${
          active
            ? 'bg-stone-200/90 dark:bg-nav-active text-stone-900 dark:text-nav-active-fg dark:shadow-[inset_0_0_0_1px_var(--nav-active-ring)]'
            : 'text-muted dark:text-paper/70 hover:bg-stone-100 dark:hover:bg-nav-hover hover:text-stone-800 dark:hover:text-paper'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`shrink-0 px-3 pt-3 pb-2 space-y-2 border-b ${isDark ? 'border-stone-800' : 'border-stone-100'}`}>
        <div className="relative">
          <Search aria-hidden className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Escape empties the box first; a second Escape leaves it.
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery('');
              }
            }}
            placeholder="Search marks and notes"
            aria-label="Search marks and notes"
            className={`w-full h-8 pl-8 pr-8 rounded-lg border text-[12.5px] outline-none [&::-webkit-search-cancel-button]:hidden focus-visible:ring-2 focus-visible:ring-gold/60 ${
              isDark
                ? 'bg-night-2 border-stone-700 text-stone-100 placeholder:text-paper/50'
                : 'bg-white border-stone-200 text-stone-800 placeholder:text-muted'
            }`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear the search"
              className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-stone-800 dark:hover:text-paper cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {kinds.length > 1 && (
          // Wrapped, never scrolled: every kind stays readable whole at any panel width.
          <div role="group" aria-label="Show only" className="flex flex-wrap items-center gap-1">
            {chip(null, 'All')}
            {kinds.map((k) => chip(k, NOTE_KIND_LABELS[k]))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
      {groups.length === 0 && filtering && (
        <p role="status" className="px-2 py-8 text-center text-[12px] text-muted">
          No marks match.{' '}
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setKind(null);
            }}
            className="underline underline-offset-2 hover:text-stone-800 dark:hover:text-paper cursor-pointer"
          >
            Show all
          </button>
        </p>
      )}
      {groups.map((group) => (
        <section key={group.id ?? 'untagged'} className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
            <h3 className="caps text-muted">{group.name}</h3>
            <span className="text-[10px] tabular-nums text-muted">{group.items.length}</span>
          </div>

          {group.items.map((a) => {
            const Icon = KIND_ICONS[a.kind] || StickyNote;
            const isHovered = hoveredId === a.id;
            return (
              <div
                key={a.id}
                onMouseEnter={() => onHover(a.id)}
                onMouseLeave={() => onHover(null)}
                className={`group relative rounded-xl border transition-all ${
                  isHovered
                    ? isDark
                      ? 'bg-night-3 border-stone-600 shadow-md'
                      : 'bg-white border-stone-300 shadow-md'
                    : isDark
                      ? 'bg-night-2 border-stone-800'
                      : 'bg-white/70 border-stone-200'
                }`}
                style={{ borderLeft: `3px solid ${a.color}` }}
              >
                {/* The whole card goes to the mark: the button's ::after covers it, and the
                    footer's own buttons sit above that. */}
                <button
                  type="button"
                  onClick={() => onSelect(a)}
                  onFocus={() => onHover(a.id)}
                  onBlur={() => onHover(null)}
                  title="Go to this mark"
                  className="w-full text-left px-3 pt-3 pb-1 cursor-pointer after:absolute after:inset-0 after:rounded-xl after:content-['']"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: `${a.color}26`, color: a.color }}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      {a.text ? (
                        <p className="text-[12.5px] text-stone-800 dark:text-stone-200 leading-snug whitespace-pre-wrap break-words line-clamp-4">
                          {a.text}
                        </p>
                      ) : a.quote ? (
                        <p className="text-[12px] italic text-stone-600 dark:text-stone-400 leading-snug line-clamp-3">
                          &ldquo;{a.quote}&rdquo;
                        </p>
                      ) : (
                        <p className="text-[12px] italic text-muted capitalize">{a.kind}</p>
                      )}
                      {a.text && a.quote && (
                        <p
                          className="mt-1.5 pl-2 border-l text-[11.5px] italic text-muted leading-snug line-clamp-2"
                          style={{ borderLeftColor: a.color }}
                        >
                          &ldquo;{a.quote}&rdquo;
                        </p>
                      )}
                      {a.needsReview && (
                        // A quote that held app menu text and could not be repaired (quoteRepair.ts).
                        <p className="mt-1 text-[11px] font-semibold text-gold" title="This quote picked up the app’s menus and could not be rebuilt. Edit the mark to correct it.">
                          Check this quote
                        </p>
                      )}
                    </div>
                  </div>
                </button>

                {/* Where the mark is, then re-file, edit and delete on the same line. The actions
                    show on hover and whenever focus is inside the card, so the list stays quiet
                    and every action is still reachable by Tab. */}
                <div className="flex items-center gap-1 pl-11 pr-2 pb-2 min-h-7 pointer-events-none">
                  <p className="text-[10.5px] text-muted mr-auto">{locationLabel(a)}</p>
                  <div
                    className={`relative flex items-center gap-1 transition-opacity ${
                      isHovered
                        ? 'opacity-100 pointer-events-auto'
                        : 'opacity-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
                    }`}
                  >
                    {settings.activeThemes.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => onRetag(a.id, theme.id, theme.color)}
                        title={`File under ${theme.name}`}
                        aria-label={`File under ${theme.name}`}
                        aria-pressed={a.themeId === theme.id}
                        className={`w-4 h-4 rounded-full border transition-transform hover:scale-125 cursor-pointer ${
                          a.themeId === theme.id ? 'border-stone-800 dark:border-white' : 'border-black/10'
                        }`}
                        style={{ backgroundColor: theme.color }}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => onEdit(a.id)}
                      title="Edit the note"
                      aria-label="Edit the note"
                      className="ml-1 w-6 h-6 flex items-center justify-center rounded text-muted hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(a.id)}
                      title="Delete this mark"
                      aria-label="Delete this mark"
                      className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ))}
      </div>
    </div>
  );
};
