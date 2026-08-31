/**
 * The properties menu for a mark that is currently selected.
 *
 * This is the behaviour every drawing application has and this editor was missing: draw a shape,
 * and it stays selected with its own controls floating beside it, so its colour and thickness can
 * be changed after the fact rather than only before. It also works on marks made in an earlier
 * session — click one, and the same menu appears.
 *
 * Positioned in viewport coordinates from the mark's own bounds, and flipped above the mark when
 * there is no room beneath it.
 */

import React from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { Annotation, isTextAnchored } from './annotationModel';
import { UserSettings } from '../../types';
import { NEUTRAL_COLORS, WEIGHT_STEPS } from './PdfToolbar';

interface MarkPropertiesProps {
  mark: Annotation;
  /** Viewport rectangle of the mark, used to place the menu. */
  rect: { left: number; top: number; right: number; bottom: number };
  settings: UserSettings;
  isDark?: boolean;
  onColorChange: (color: string) => void;
  onWeightChange: (weight: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Kinds drawn with a stroke, and so the only ones with a thickness worth setting. */
const STROKED = ['ink', 'rect', 'ellipse', 'arrow', 'line'];

export const MarkProperties: React.FC<MarkPropertiesProps> = ({
  mark,
  rect,
  settings,
  isDark = false,
  onColorChange,
  onWeightChange,
  onEdit,
  onDelete
}) => {
  const MENU_HEIGHT = 44;
  const below = rect.bottom + MENU_HEIGHT + 8 < window.innerHeight;
  const showsWeight = STROKED.includes(mark.kind);
  const showsText = mark.kind === 'note' || mark.kind === 'text' || isTextAnchored(mark.kind);

  return (
    <div
      className={`fixed z-50 flex items-center gap-1 p-1.5 rounded-xl shadow-2xl border ${
        isDark ? 'bg-[#1b201d] border-stone-700' : 'bg-white border-stone-200'
      }`}
      style={{
        left: Math.min(Math.max(rect.left, 8), window.innerWidth - 340),
        top: Math.max(below ? rect.bottom + 8 : rect.top - MENU_HEIGHT - 8, 8)
      }}
      // Never let this steal a text selection or start a drag on the page beneath.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-1 capitalize">
        {mark.kind}
      </span>

      <div className={`w-px h-5 ${isDark ? 'bg-stone-700' : 'bg-stone-200'}`} />

      {/* Colour */}
      <div className="flex items-center gap-1">
        {settings.activeThemes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            onClick={() => onColorChange(theme.color)}
            title={theme.name}
            className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer ${
              mark.color.toLowerCase() === theme.color.toLowerCase()
                ? 'border-stone-800 dark:border-white'
                : 'border-transparent'
            }`}
            style={{ backgroundColor: theme.color }}
          />
        ))}
        {NEUTRAL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onColorChange(c)}
            title="Untagged colour"
            className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer ${
              mark.color.toLowerCase() === c.toLowerCase() ? 'border-stone-800 dark:border-white' : 'border-transparent'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
        <label
          title="Custom colour"
          className="w-5 h-5 rounded-full border border-black/15 dark:border-white/25 cursor-pointer overflow-hidden shrink-0"
          style={{ background: 'conic-gradient(#ef4444,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444)' }}
        >
          <input
            type="color"
            value={mark.color}
            onChange={(e) => onColorChange(e.target.value)}
            className="opacity-0 w-full h-full cursor-pointer"
          />
        </label>
      </div>

      {/* Thickness */}
      {showsWeight && (
        <>
          <div className={`w-px h-5 mx-0.5 ${isDark ? 'bg-stone-700' : 'bg-stone-200'}`} />
          <div className="flex items-center gap-0.5">
            {WEIGHT_STEPS.map((step) => (
              <button
                key={step.value}
                type="button"
                onClick={() => onWeightChange(step.value)}
                title={`${step.label} thickness`}
                className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                  mark.weight === step.value
                    ? 'bg-stone-200 dark:bg-stone-700'
                    : 'hover:bg-stone-100 dark:hover:bg-stone-800'
                }`}
              >
                <span
                  className="block w-4 rounded-full"
                  style={{ height: Math.max(1, step.value * 620), backgroundColor: mark.color }}
                />
              </button>
            ))}
          </div>
        </>
      )}

      <div className={`w-px h-5 mx-0.5 ${isDark ? 'bg-stone-700' : 'bg-stone-200'}`} />

      {showsText && (
        <button
          type="button"
          onClick={onEdit}
          title="Write a comment on this mark"
          className="p-1.5 rounded-lg text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        title="Delete this mark"
        className="p-1.5 rounded-lg text-stone-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
