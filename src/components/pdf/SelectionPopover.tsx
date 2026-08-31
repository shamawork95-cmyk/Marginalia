/**
 * The menu that appears next to a text selection.
 *
 * This is the fastest path from "I want to mark this" to a mark: select, then choose. It also
 * carries the only way to create a sticky note ABOUT a passage — the note is placed beside the
 * text and remembers which passage it belongs to, which is what lets hovering it light the
 * passage back up.
 *
 * Positioned in viewport coordinates from the selection's own rectangle, and flipped above the
 * selection when there is no room below, so it never sits off-screen.
 */

import React from 'react';
import { Highlighter, Underline, Strikethrough, StickyNote, X } from 'lucide-react';
import { AnnotationKind } from './annotationModel';

export interface SelectionAnchor {
  /** Viewport position of the selection, used to place the menu. */
  left: number;
  top: number;
  bottom: number;
}

interface SelectionPopoverProps {
  anchor: SelectionAnchor | null;
  isDark?: boolean;
  /** Colour each text tool will use, so the menu shows what it is about to do. */
  toolColors: Record<string, string>;
  onMark: (kind: AnnotationKind) => void;
  onCreateNote: () => void;
  onDismiss: () => void;
}

const ACTIONS: { kind: AnnotationKind; label: string; icon: React.ElementType }[] = [
  { kind: 'highlight', label: 'Highlight', icon: Highlighter },
  { kind: 'underline', label: 'Underline', icon: Underline },
  { kind: 'strikeout', label: 'Strikeout', icon: Strikethrough }
];

export const SelectionPopover: React.FC<SelectionPopoverProps> = ({
  anchor,
  isDark = false,
  toolColors,
  onMark,
  onCreateNote,
  onDismiss
}) => {
  if (!anchor) return null;

  const MENU_HEIGHT = 44;
  // Below the selection normally; above it when the selection sits near the bottom of the window.
  const below = anchor.bottom + MENU_HEIGHT + 8 < window.innerHeight;
  const top = below ? anchor.bottom + 8 : anchor.top - MENU_HEIGHT - 8;

  return (
    <div
      className={`fixed z-50 flex items-center gap-0.5 p-1 rounded-xl shadow-2xl border ${
        isDark ? 'bg-[#1b201d] border-stone-700' : 'bg-white border-stone-200'
      }`}
      style={{
        left: Math.min(Math.max(anchor.left, 8), window.innerWidth - 300),
        top: Math.max(top, 8)
      }}
      // Pressing anything here must not clear the selection it is about to act on.
      onMouseDown={(e) => e.preventDefault()}
    >
      {ACTIONS.map(({ kind, label, icon: Icon }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onMark(kind)}
          title={label}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
        >
          <Icon className="w-3.5 h-3.5" style={{ color: toolColors[kind] }} />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}

      <div className={`w-px h-5 mx-0.5 ${isDark ? 'bg-stone-700' : 'bg-stone-200'}`} />

      <button
        type="button"
        onClick={onCreateNote}
        title="Write a sticky note about this passage"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
      >
        <StickyNote className="w-3.5 h-3.5" style={{ color: toolColors.note }} />
        <span>Sticky note</span>
      </button>

      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
