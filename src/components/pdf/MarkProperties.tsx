/**
 * The properties strip for the mark that is currently selected.
 *
 * Draw a shape and it stays selected with its own controls floating beside it, so its colour,
 * thickness and dash pattern can be changed after the fact rather than only before. It works on
 * marks made in an earlier session too — click one, and the same strip appears.
 *
 * Every control here is the same component the main toolbar uses (see `StyleControls`), so a mark
 * can be restyled in exactly the vocabulary it was drawn in.
 *
 * Positioned in viewport coordinates from the mark's own bounds, and flipped above the mark when
 * there is no room beneath it. It closes the moment the reader presses anywhere else — see
 * `useDismiss` — because a strip that outlives the selection it describes is worse than no strip.
 */

import React, { useRef } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import {
  Annotation,
  BracketSide,
  NoteStyle,
  StrokeStyle,
  TextAlign,
  TextFont,
  isStroked,
  isTextAnchored
} from './annotationModel';
import { UserSettings } from '../../types';
import {
  AlignPicker,
  BracketSidePicker,
  EmphasisPicker,
  FontPicker,
  ColorPalette,
  Divider,
  NoteStylePicker,
  StrokeStylePicker,
  TextSizePicker,
  WeightPicker
} from './StyleControls';
import { useDismiss } from './useDismiss';
import { useAnchoredPanel } from './useAnchoredPanel';

interface MarkPropertiesProps {
  mark: Annotation;
  /** Viewport rectangle of the mark, used to place the strip. */
  rect: { left: number; top: number; right: number; bottom: number };
  settings: UserSettings;
  isDark?: boolean;
  onColorChange: (color: string) => void;
  onWeightChange: (weight: number) => void;
  onStrokeStyleChange: (style: StrokeStyle) => void;
  onNoteStyleChange: (style: NoteStyle) => void;
  onBracketSideChange: (side: BracketSide) => void;
  onTextSizeChange: (size: number) => void;
  onTextAlignChange: (align: TextAlign) => void;
  onTextFontChange: (font: TextFont) => void;
  onTextBoldChange: (bold: boolean) => void;
  onTextItalicChange: (italic: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Clears the selection, which is what takes this strip off the screen. */
  onDismiss: () => void;
}

export const MarkProperties: React.FC<MarkPropertiesProps> = ({
  mark,
  rect,
  settings,
  isDark = false,
  onColorChange,
  onWeightChange,
  onStrokeStyleChange,
  onNoteStyleChange,
  onBracketSideChange,
  onTextSizeChange,
  onTextAlignChange,
  onTextFontChange,
  onTextBoldChange,
  onTextItalicChange,
  onEdit,
  onDelete,
  onDismiss
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // The strip is always "open" while a mark is selected, so dismissal here means deselecting.
  // Presses inside the strip are ignored, which is what lets several options be tried in a row —
  // and so are presses on the mark's own handles out on the page, which would otherwise deselect
  // the mark at the very moment the reader grabbed it.
  useDismiss(ref, true, onDismiss, '[data-mark-ui]');

  // Highlights fill rather than stroke, so they have no thickness or dash pattern to set.
  const showsStroke = isStroked(mark.kind);
  const showsText = mark.kind === 'note' || mark.kind === 'text' || isTextAnchored(mark.kind);

  // Measured rather than guessed: the strip's width depends on which controls its kind needs, so
  // the kind is what re-triggers the measurement.
  const panel = useAnchoredPanel(ref, rect, [mark.kind]);

  return (
    <div
      ref={ref}
      className={`fixed z-50 flex items-center gap-1 p-1.5 rounded-xl shadow-2xl border ${
        isDark ? 'bg-[#1b201d] border-stone-700' : 'bg-white border-stone-200'
      }`}
      style={panel}
      // Never let this steal a text selection or start a drag on the page beneath.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-1 capitalize">
        {mark.kind}
      </span>

      <Divider isDark={isDark} />

      <ColorPalette
        color={mark.color}
        themes={settings.activeThemes}
        customColors={settings.customColors}
        onlyCustomColors
        onChange={onColorChange}
      />

      {showsStroke && (
        <>
          <Divider isDark={isDark} />
          <WeightPicker weight={mark.weight} color={mark.color} onChange={onWeightChange} swatchScale={620} />
          <Divider isDark={isDark} />
          <StrokeStylePicker value={mark.strokeStyle} color={mark.color} onChange={onStrokeStyleChange} />
        </>
      )}

      {mark.kind === 'note' && (
        <>
          <Divider isDark={isDark} />
          <NoteStylePicker value={mark.noteStyle} color={mark.color} onChange={onNoteStyleChange} />
        </>
      )}

      {mark.kind === 'bracket' && (
        <>
          <Divider isDark={isDark} />
          <BracketSidePicker value={mark.bracketSide} onChange={onBracketSideChange} />
        </>
      )}

      {mark.kind === 'text' && (
        <>
          <Divider isDark={isDark} />
          <FontPicker value={mark.font} onChange={onTextFontChange} />
          <Divider isDark={isDark} />
          <EmphasisPicker
            bold={mark.bold}
            italic={mark.italic}
            onBoldChange={onTextBoldChange}
            onItalicChange={onTextItalicChange}
          />
          <Divider isDark={isDark} />
          <TextSizePicker value={mark.fontSize} color={mark.color} onChange={onTextSizeChange} />
          <Divider isDark={isDark} />
          <AlignPicker value={mark.align} color={mark.color} onChange={onTextAlignChange} />
        </>
      )}

      <Divider isDark={isDark} />

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
