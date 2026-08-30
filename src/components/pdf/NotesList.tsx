/**
 * Every mark in the document, grouped by theme.
 *
 * Grouping is exact rather than inferred: each mark stores its own `themeId`, so re-colouring a
 * mark or editing a theme's colour never re-files anything by accident. Hovering a row raises the
 * mark on the page; clicking scrolls to it.
 */

import React from 'react';
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
  Type,
  Trash2,
  Pencil
} from 'lucide-react';
import { Annotation, AnnotationKind } from './annotationModel';
import { UserSettings } from '../../types';

const KIND_ICONS: Record<AnnotationKind, React.ElementType> = {
  highlight: Highlighter,
  underline: Underline,
  strikeout: Strikethrough,
  ink: PenLine,
  note: StickyNote,
  rect: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
  line: Minus,
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
}

export const NotesList: React.FC<NotesListProps> = ({
  annotations,
  settings,
  isDark = false,
  hoveredId,
  onHover,
  onSelect,
  onRetag,
  onDelete,
  onEdit
}) => {
  // Reading order within each theme: someone scanning this is walking the document front to back.
  const sorted = [...annotations].sort((a, b) => a.page - b.page);
  const groups = [
    ...settings.activeThemes.map((theme) => ({
      id: theme.id as string | null,
      name: theme.name,
      color: theme.color,
      items: sorted.filter((a) => a.themeId === theme.id)
    })),
    { id: null, name: 'Untagged', color: '#a8a29e', items: sorted.filter((a) => a.themeId === null) }
  ].filter((group) => group.items.length > 0);

  if (annotations.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-10 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
          <StickyNote className="w-6 h-6" />
        </div>
        <h3 className="font-serif text-[17px] font-bold text-stone-900 dark:text-white">Nothing marked yet</h3>
        <p className="text-[12px] text-stone-500 dark:text-stone-400 max-w-[15rem] mx-auto leading-relaxed">
          Pick a theme in the toolbar, then highlight a passage or drop a note. Everything you mark
          collects here, grouped by theme.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
      {groups.map((group) => (
        <section key={group.id ?? 'untagged'} className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
            <h3 className="text-[10.5px] font-semibold tracking-wider uppercase text-stone-500">{group.name}</h3>
            <span className="text-[10px] tabular-nums text-stone-400">{group.items.length}</span>
          </div>

          {group.items.map((a) => {
            const Icon = KIND_ICONS[a.kind] || StickyNote;
            const isHovered = hoveredId === a.id;
            return (
              <div
                key={a.id}
                onMouseEnter={() => onHover(a.id)}
                onMouseLeave={() => onHover(null)}
                className={`rounded-xl border transition-all ${
                  isHovered
                    ? isDark
                      ? 'bg-[#1b201d] border-stone-600 shadow-md'
                      : 'bg-white border-stone-300 shadow-md'
                    : isDark
                      ? 'bg-[#181c19] border-stone-800'
                      : 'bg-white/70 border-stone-200'
                }`}
                style={{ borderLeft: `3px solid ${a.color}` }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(a)}
                  onFocus={() => onHover(a.id)}
                  onBlur={() => onHover(null)}
                  title="Go to this mark"
                  className="w-full text-left p-3 cursor-pointer"
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
                        <p className="text-[12px] italic text-stone-400 capitalize">{a.kind}</p>
                      )}
                      {a.text && a.quote && (
                        <p
                          className="mt-1.5 pl-2 border-l text-[11.5px] italic text-stone-500 dark:text-stone-400 leading-snug line-clamp-2"
                          style={{ borderLeftColor: a.color }}
                        >
                          &ldquo;{a.quote}&rdquo;
                        </p>
                      )}
                      <p className="text-[10.5px] text-stone-500 mt-1">Page {a.page}</p>
                    </div>
                  </div>
                </button>

                {/* Re-file, edit and delete. Revealed on hover so the list stays readable. */}
                <div
                  className={`px-3 pb-2 -mt-1 flex items-center gap-1 flex-wrap transition-opacity ${
                    isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  {settings.activeThemes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => onRetag(a.id, theme.id, theme.color)}
                      title={`File under ${theme.name}`}
                      className={`w-4 h-4 rounded-full border transition-transform hover:scale-125 cursor-pointer ${
                        a.themeId === theme.id ? 'border-stone-800 dark:border-white' : 'border-black/10'
                      }`}
                      style={{ backgroundColor: theme.color }}
                    />
                  ))}
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => onEdit(a.id)}
                    title="Edit the note"
                    className="p-1 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(a.id)}
                    title="Delete this mark"
                    className="p-1 rounded text-stone-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
};
