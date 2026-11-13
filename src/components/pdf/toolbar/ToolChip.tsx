/**
 * A toolbar tool's style chip: the colour swatch under the tool and its panel of colours, weight,
 * dash, note fill, bracket side and text-box type (moved verbatim from PdfToolbar).
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BracketSide, NoteStyle, StrokeStyle, TextAlign, TextFont } from '../annotationModel';
import {
  AlignPicker,
  BracketSidePicker,
  ColorPalette,
  EmphasisPicker,
  FontPicker,
  Divider,
  NoteStylePicker,
  StrokeStylePicker,
  TextSizePicker,
  WeightPicker
} from '../StyleControls';
import { useDismiss } from '../useDismiss';
import { UserSettings } from '../../../types';
import { HoverTooltip } from '../../HoverTooltip';

/**
 * The style chip beneath a tool, and the menu it opens.
 *
 * Each marking tool carries its own settings, so the chip both SHOWS what that tool will draw and
 * is the way to change it — no trip to a shared palette, and no ambiguity about which tool a
 * colour applies to.
 */
export const ToolChip: React.FC<{
  color: string;
  themes: UserSettings['activeThemes'];
  customColors?: string[];
  onColorChange: (color: string, themeId: string | null) => void;
  isDark: boolean;
  label: string;
  /** Present only for tools that stroke; a highlight fills its line box and has no thickness. */
  weight?: number;
  onWeightChange?: (weight: number) => void;
  strokeStyle?: StrokeStyle;
  onStrokeStyleChange?: (style: StrokeStyle) => void;
  noteStyle?: NoteStyle;
  onNoteStyleChange?: (style: NoteStyle) => void;
  bracketSide?: BracketSide;
  onBracketSideChange?: (side: BracketSide) => void;
  textSize?: number;
  onTextSizeChange?: (size: number) => void;
  textAlign?: TextAlign;
  onTextAlignChange?: (align: TextAlign) => void;
  textFont?: TextFont;
  onTextFontChange?: (font: TextFont) => void;
  textBold?: boolean;
  onTextBoldChange?: (bold: boolean) => void;
  textItalic?: boolean;
  onTextItalicChange?: (italic: boolean) => void;
  /** Opens the menu from outside — used when a tool is applied from the selection menu. */
  forceOpen?: boolean;
  /** Reports the menu opening and closing, so the toolbar's owner knows what is on screen and a
   *  second tap on the tool can close it rather than reopening what was just dismissed. */
  onOpenChange?: (open: boolean) => void;
  onForceHandled?: () => void;
}> = ({
  color,
  themes,
  customColors,
  onColorChange,
  isDark,
  label,
  weight,
  onWeightChange,
  strokeStyle,
  onStrokeStyleChange,
  noteStyle,
  onNoteStyleChange,
  bracketSide,
  onBracketSideChange,
  textSize,
  onTextSizeChange,
  textAlign,
  onTextAlignChange,
  textFont,
  onTextFontChange,
  textBold,
  onTextBoldChange,
  textItalic,
  onTextItalicChange,
  forceOpen,
  onOpenChange,
  onForceHandled
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /**
   * Where the menu lands, in VIEWPORT coordinates rather than a translate offset relative to its
   * chip.
   *
   * The toolbar sits inside the workspace's `overflow-hidden` scroll shell, and this menu used to
   * be positioned with plain `absolute` — which that ancestor clips at its own left edge the
   * moment the menu is centred under a chip near the start of the toolbar, cutting the palette off
   * behind the sidebar rather than showing it over the top of it. `position: fixed`, measured from
   * the chip's own screen position, escapes that clipping the same way the selection menu and mark
   * properties strip already do (see `useAnchoredPanel`) — this menu centres under its chip
   * instead of hugging its left edge, so it keeps its own measure-then-clamp pass rather than
   * reusing that hook outright.
   */
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const measure = () => {
      const chip = ref.current;
      const menu = menuRef.current;
      if (!chip || !menu) return;
      const anchor = chip.getBoundingClientRect();
      const { width, height } = menu.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      const idealLeft = anchor.left + anchor.width / 2 - width / 2;
      const maxLeft = window.innerWidth - width - margin;
      const below = anchor.bottom + gap + height <= window.innerHeight;
      setMenuPos({
        left: Math.max(margin, Math.min(idealLeft, Math.max(margin, maxLeft))),
        top: below ? anchor.bottom + gap : anchor.top - gap - height
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  // Opening is a one-shot request: it is acknowledged immediately so the menu can then be closed
  // normally rather than being forced back open on every render.
  useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    onForceHandled?.();
  }, [forceOpen, onForceHandled]);

  useEffect(() => {
    onOpenChange?.(open);
    // `onOpenChange` is not a dependency on purpose: callers pass an inline closure, and
    // including it would report on every render of the toolbar rather than on a real change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Closing on any press outside, and on Escape, is shared with every other floating surface in
  // the workspace — see `useDismiss` for why it listens for pointerdown rather than click.
  // The menu is portalled out of the tools row (its edge-fade mask clips even fixed children),
  // so presses inside it are declared inside here.
  useDismiss(ref, open, () => setOpen(false), '[data-chip-menu]');

  return (
    // The menu closes only on a press outside or on Escape — never on picking an option, so
    // several can be tried in a row and each change is seen on the page.
    <div ref={ref} className="relative flex justify-center">
      <HoverTooltip label={`${label} options`}>
        <button
          type="button"
          // Keeps a live text selection alive — pressing this must not discard what the reader is
          // about to mark.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
          aria-label={`${label} options`}
          aria-expanded={open}
          className="w-6 h-2.5 rounded-full border border-black/15 dark:border-paper/50 cursor-pointer transition-transform hover:scale-110"
          style={{ backgroundColor: color }}
        />
      </HoverTooltip>

      {open && createPortal(
        <div
          ref={menuRef}
          data-chip-menu
          className={`fixed z-50 p-2 rounded-xl shadow-xl border flex items-center gap-1.5 ${
            isDark ? 'bg-night-3 border-stone-700' : 'bg-white border-stone-200'
          }`}
          style={{
            left: menuPos?.left ?? 0,
            top: menuPos?.top ?? 0,
            // Hidden for the single frame between mounting and being measured, so the menu is
            // never seen at the wrong place before `menuPos` is corrected.
            visibility: menuPos ? 'visible' : 'hidden'
          }}
        >
          <ColorPalette color={color} themes={themes} customColors={customColors} onChange={onColorChange} />

          {onWeightChange && (
            <>
              <Divider isDark={isDark} />
              <WeightPicker weight={weight} color={color} onChange={onWeightChange} swatchScale={1400} />
            </>
          )}

          {onStrokeStyleChange && (
            <>
              <Divider isDark={isDark} />
              <StrokeStylePicker value={strokeStyle} color={color} onChange={onStrokeStyleChange} />
            </>
          )}

          {onNoteStyleChange && (
            <>
              <Divider isDark={isDark} />
              <NoteStylePicker value={noteStyle} color={color} onChange={onNoteStyleChange} />
            </>
          )}

          {onBracketSideChange && (
            <>
              <Divider isDark={isDark} />
              <BracketSidePicker value={bracketSide} onChange={onBracketSideChange} />
            </>
          )}

          {onTextSizeChange && onTextAlignChange && onTextFontChange && onTextBoldChange && onTextItalicChange && (
            <>
              <Divider isDark={isDark} />
              <FontPicker value={textFont} onChange={onTextFontChange} />
              <Divider isDark={isDark} />
              <EmphasisPicker
                bold={textBold}
                italic={textItalic}
                onBoldChange={onTextBoldChange}
                onItalicChange={onTextItalicChange}
              />
              <Divider isDark={isDark} />
              <TextSizePicker value={textSize} color={color} onChange={onTextSizeChange} />
              <Divider isDark={isDark} />
              <AlignPicker value={textAlign} color={color} onChange={onTextAlignChange} />
            </>
          )}
        </div>,
        document.getElementById('app-container') ?? document.body
      )}
    </div>
  );
};
