/**
 * The annotation toolbar: tools, per-tool style menus, undo, the theme picker, zoom and paging.
 *
 * The colour picker is the theme picker. Choosing "Questions" sets both the colour and the theme
 * every new mark is filed under, so colour-coding is a consequence of marking rather than a step
 * afterwards — this is the whole reason for owning the annotation model.
 *
 * Each tool's chip opens the full set of options for that tool — colour, thickness, dash pattern,
 * and whatever else its kind has. The same controls appear in the properties strip beside a
 * selected mark, so what is set BEFORE drawing and what is changed AFTER are never two different
 * vocabularies.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2,
  Highlighter,
  Underline,
  Strikethrough,
  PenLine,
  StickyNote,
  Square,
  Circle,
  ArrowUpRight,
  Minus,
  Braces,
  Type,
  Tag,
  EyeOff,
  Eraser,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronUp,
  ChevronDown,
  AreaSelect,
  Download,
  Loader2,
  BookOpen,
  FileText,
  FilePlus2
} from '../icons';
import {
  BracketSide,
  NoteStyle,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont,
  isStroked,
  isTextAnchored
} from './annotationModel';
import {
  AlignPicker,
  BracketSidePicker,
  ColorPalette,
  DARK_SWATCH_RING,
  EmphasisPicker,
  FontPicker,
  Divider,
  isInkOnDark,
  NEUTRAL_COLORS,
  NoteStylePicker,
  StrokeStylePicker,
  TextSizePicker,
  WeightPicker
} from './StyleControls';
import { useDismiss } from './useDismiss';
import { ArchivePanel, type ArchiveRow } from '../MarksArchive';
import { UserSettings } from '../../types';
import type { PdfViewMode } from '../../utils/documentStorage';
import { HoverTooltip } from '../HoverTooltip';
import { TOOL_HOTKEYS, themeShortcut, withShortcut } from './workspaceKeys';

export { NEUTRAL_COLORS, WEIGHT_STEPS } from './StyleControls';

/**
 * Export: the annotated PDF first, then the marks archive. A fixed panel measured from its
 * button (the toolbar row scrolls sideways on a phone and would clip an absolute one).
 */
const ExportMenu: React.FC<{ onExport: () => void; isExporting: boolean; rows?: ArchiveRow[]; isDark: boolean }> = ({
  onExport,
  isExporting,
  rows,
  isDark
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Portalled: the tools row is masked for its edge fade, and a mask clips even fixed children.
  useDismiss(ref, open, () => setOpen(false), '[data-export-menu]');
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const measure = () => {
      const a = ref.current?.getBoundingClientRect();
      const m = menuRef.current?.getBoundingClientRect();
      if (!a || !m) return;
      const left = Math.max(8, Math.min(a.right - m.width, window.innerWidth - m.width - 8));
      setPos({ left, top: Math.min(a.bottom + 6, Math.max(8, window.innerHeight - m.height - 8)) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  if (!rows) {
    return (
      <HoverTooltip label="Export a PDF with your marks embedded as real PDF annotations">
        <button type="button" onClick={onExport} disabled={isExporting} className={EXPORT_BTN}>
          {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span className="hidden lg:inline">Export PDF</span>
        </button>
      </HoverTooltip>
    );
  }
  return (
    <div ref={ref} className="relative">
      <HoverTooltip label="Export the annotated PDF, your marks or a commonplace book">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Export"
          className={EXPORT_BTN}
        >
          {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span className="hidden lg:inline">Export</span>
          <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
      </HoverTooltip>
      {open && createPortal(
        <div
          ref={menuRef}
          data-export-menu
          role="group"
          aria-label="Export options"
          className={`fixed z-50 w-[min(26rem,calc(100vw-16px))] max-h-[calc(100vh-16px)] overflow-y-auto rounded-2xl shadow-2xl border ${
            isDark ? 'bg-night-3 border-stone-700' : 'bg-white border-stone-200'
          }`}
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        >
          <div className="px-3 py-2.5 flex items-center justify-between gap-3 border-b border-stone-200 dark:border-stone-700/70">
            <div className="min-w-0">
              <div className="font-bold text-[13px] text-stone-900 dark:text-paper">Annotated PDF</div>
              <div className="text-[11.5px] text-muted leading-snug">Your marks embedded as real PDF annotations.</div>
            </div>
            <button
              type="button"
              disabled={isExporting}
              onClick={() => {
                onExport();
                setOpen(false);
              }}
              className="shrink-0 rounded-full caps caps-sm px-3 py-1.5 bg-accent text-on-accent hover:bg-accent-hover cursor-pointer disabled:opacity-50"
            >
              Save PDF
            </button>
          </div>
          <ArchivePanel rows={rows} compact onAction={() => setOpen(false)} />
        </div>,
        // Inside the app container, so the `.dark` theme and its tokens still apply.
        document.getElementById('app-container') ?? document.body
      )}
    </div>
  );
};

const EXPORT_BTN =
  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50';

interface PdfToolbarProps {
  tool: PdfTool;
  onToolChange: (tool: PdfTool) => void;
  /** True while text is selected, so the text tools can advertise that they will act on it. */
  hasSelection: boolean;
  settings: UserSettings;
  activeThemeId: string | null;
  onThemeChange: (themeId: string | null) => void;
  /** A colour per tool, so highlighting yellow and underlining red do not fight each other. */
  toolColors: Record<string, string>;
  onToolColorChange: (tool: string, color: string) => void;
  /** Stroke weight per tool, as a fraction of page width. */
  toolWeights: Record<string, number>;
  onToolWeightChange: (tool: string, weight: number) => void;
  /** Dash pattern per tool. */
  toolStrokeStyles: Record<string, StrokeStyle>;
  onToolStrokeStyleChange: (tool: string, style: StrokeStyle) => void;
  /** Fill style new sticky notes get. */
  noteStyle: NoteStyle;
  onNoteStyleChange: (style: NoteStyle) => void;
  /** Which way new brackets open. */
  bracketSide: BracketSide;
  onBracketSideChange: (side: BracketSide) => void;
  /** Type size and alignment new text boxes get. */
  textSize: number;
  onTextSizeChange: (size: number) => void;
  textAlign: TextAlign;
  onTextAlignChange: (align: TextAlign) => void;
  textFont: TextFont;
  onTextFontChange: (font: TextFont) => void;
  textBold: boolean;
  onTextBoldChange: (bold: boolean) => void;
  textItalic: boolean;
  onTextItalicChange: (italic: boolean) => void;
  /** Opens this tool's style submenu — set after applying a tool from the selection menu. */
  openSubmenuFor?: string | null;
  /** Tells the workspace which tool's options are on screen right now. */
  onSubmenuOpenChange?: (tool: string, open: boolean) => void;
  onSubmenuOpened?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  scale: number;
  onScaleChange: (scale: number) => void;
  onFitWidth: () => void;
  currentPage: number;
  pageCount: number;
  onGoToPage: (page: number) => void;
  viewMode: PdfViewMode;
  onViewModeChange: (mode: PdfViewMode) => void;
  onInsertPage: () => void;
  markCount: number;
  onExport: () => void;
  isExporting: boolean;
  /** Markdown, JSON, commonplace book, import and restore (see `MarksArchive`), under Export. */
  archiveRows?: ArchiveRow[];
  /**
   * The side-panel toggles, rendered at the end of this row.
   *
   * They used to live in the title bar above, which on the desktop build is also the window's
   * drag handle and its traffic-light corner — a cramped strip that is not where any of the
   * document's other controls are. They belong with the rest of the tools.
   */
  panelControls?: React.ReactNode;
  /** Tighten the row's spacing, for when the expanded sidebar has taken its width. */
  compact?: boolean;
  isDark?: boolean;
}

const TOOL_GROUPS: { id: PdfTool; label: string; icon: React.ElementType; hint: string }[][] = [
  [
    // Select: the resting state. Text is freely selectable, marks can be picked, nothing is
    // drawn. Returning to it is how you stop a drawing tool being armed.
    { id: 'select', label: 'Select', icon: MousePointer2, hint: 'Select text and marks, and drag marks around' },
    { id: 'highlight', label: 'Highlight', icon: Highlighter, hint: 'Select text to highlight it' },
    { id: 'area', label: 'Area highlight', icon: AreaSelect, hint: 'Drag a box over a figure, table or image to highlight that area' },
    { id: 'underline', label: 'Underline', icon: Underline, hint: 'Select text to underline it' },
    { id: 'strikeout', label: 'Strikeout', icon: Strikethrough, hint: 'Select text to strike it out' },
    {
      id: 'terminology',
      label: 'Terminology',
      icon: Tag,
      hint: 'Select a term to mark it as terminology — always in the colour set in Settings'
    }
  ],
  [
    { id: 'ink', label: 'Pen', icon: PenLine, hint: 'Draw freehand' },
    { id: 'mask', label: 'Mask', icon: EyeOff, hint: 'Drag a box over something to black it out' },
    { id: 'rect', label: 'Rectangle', icon: Square, hint: 'Drag a rectangle' },
    { id: 'ellipse', label: 'Ellipse', icon: Circle, hint: 'Drag an ellipse' },
    { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, hint: 'Drag to draw an arrow on the page' },
    { id: 'line', label: 'Line', icon: Minus, hint: 'Drag a line' },
    {
      id: 'bracket',
      label: 'Bracket',
      icon: Braces,
      hint: 'Drag down a margin to brace a passage — choose which way it opens below'
    }
  ],
  [
    { id: 'note', label: 'Note', icon: StickyNote, hint: 'Click to place a handwritten sticky note' },
    { id: 'text', label: 'Text box', icon: Type, hint: 'Drag a box, then type' },
    { id: 'erase', label: 'Erase', icon: Eraser, hint: 'Click a mark to delete it' }
  ]
];

/**
 * The style chip beneath a tool, and the menu it opens.
 *
 * Each marking tool carries its own settings, so the chip both SHOWS what that tool will draw and
 * is the way to change it — no trip to a shared palette, and no ambiguity about which tool a
 * colour applies to.
 */
const ToolChip: React.FC<{
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

/** Zoom stops, so the buttons step through predictable sizes rather than drifting by a factor. */
/**
 * How this platform writes the undo shortcut.
 *
 * The tooltips said ⌘Z everywhere, including on Windows, where the key is Ctrl and the symbol
 * means nothing. The keyboard handler already accepts either modifier; only the label was wrong.
 */
const IS_APPLE =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
const MODIFIER = IS_APPLE ? '⌘' : 'Ctrl+';
const SHIFT_MODIFIER = IS_APPLE ? '⇧⌘' : 'Ctrl+Shift+';

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];

export const PdfToolbar: React.FC<PdfToolbarProps> = ({
  tool,
  onToolChange,
  hasSelection,
  settings,
  activeThemeId,
  onThemeChange,
  toolColors,
  onToolColorChange,
  toolWeights,
  onToolWeightChange,
  toolStrokeStyles,
  onToolStrokeStyleChange,
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
  openSubmenuFor,
  onSubmenuOpenChange,
  onSubmenuOpened,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  scale,
  onScaleChange,
  onFitWidth,
  currentPage,
  pageCount,
  onGoToPage,
  viewMode,
  onViewModeChange,
  onInsertPage,
  markCount,
  onExport,
  isExporting,
  archiveRows,
  panelControls,
  compact = false,
  isDark = false
}) => {
  const stepZoom = (direction: 1 | -1) => {
    // Stepping out goes to the nearest step BELOW the current scale, stepping in to the nearest
    // ABOVE. Both used the first step at-or-above, so from a fit-to-width scale under the
    // smallest step — a wide scan often fits at 32% — pressing zoom OUT clamped to index 0 and
    // zoomed the reader in to 50%.
    if (direction === -1) {
      const below = [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.001);
      onScaleChange(below ?? ZOOM_STEPS[0]);
      return;
    }
    const above = ZOOM_STEPS.find((s) => s > scale + 0.001);
    onScaleChange(above ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  };

  // Scrolls the newly active theme into view whenever it changes — not just when the reader drags
  // the strip themselves. A theme picked from elsewhere (the selection popover, a retag) should
  // still bring itself into view here rather than leaving the reader to go hunt for it.
  const themeStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeThemeId) return;
    const el = themeStripRef.current?.querySelector<HTMLElement>(`[data-theme-id="${activeThemeId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeThemeId]);

  return (
    <div
      className={`flex flex-col shrink-0 border-b ${
        isDark ? 'bg-night-2 border-stone-800' : 'bg-white border-stone-200'
      }`}
    >
      {/* Tools, undo, zoom and pages */}
      {/*
        One row, always.
        
        It used to wrap, which on a narrow window dropped the last controls onto a second line —
        a toolbar that changes height as the window resizes, and buttons that move out from under
        the cursor. Scrolling sideways keeps the row one row: the tools nearest the left are the
        ones reached most, and nothing is ever hidden without a way to reach it.
      */}
      <div
        className={`flex items-center flex-nowrap py-2 overflow-x-auto hide-scrollbar [&>*]:shrink-0 ${
          compact ? 'gap-0.5 px-2' : 'gap-1 px-3'
        }`}
      >
        {TOOL_GROUPS.map((group, groupIndex) => (
          <React.Fragment key={groupIndex}>
            {groupIndex > 0 && (
              <div className={`w-px h-6 ${compact ? 'mx-0.5' : 'mx-1'} ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />
            )}
            {group.map(({ id, label, icon: Icon, hint }) => {
              const isActive = tool === id;
              // A text tool with text already selected will act on that selection right now, so
              // it says so rather than describing what happens after the next drag.
              const actsNow = hasSelection && isTextAnchored(id);
              // Only tools that actually draw carry a style chip. Terminology has nothing to
              // configure here either — its colour lives in Settings → Terminology, not per-tool.
              const hasChip = id !== 'erase' && id !== 'select' && id !== 'terminology';
              // Everything drawn with a stroke gets a thickness and a dash pattern. Highlight is
              // the exception: it fills the line box rather than stroking, so it has neither.
              const strokes = isStroked(id as never);
              return (
                <div key={id} className="flex flex-col items-center gap-0.5">
                  <HoverTooltip label={withShortcut(actsNow ? `${label} the selected text` : hint, TOOL_HOTKEYS[id])}>
                    <button
                      type="button"
                      // Pressing a button moves focus, which would clear the text selection before
                      // the click handler ever ran. Suppressing the default keeps the selection
                      // alive — and visible — so tapping the tool can apply to it.
                      onMouseDown={(e) => e.preventDefault()}
                      data-mark-tool
                      onClick={() => onToolChange(id)}
                      aria-label={withShortcut(label, TOOL_HOTKEYS[id])}
                      aria-keyshortcuts={TOOL_HOTKEYS[id]}
                      aria-pressed={isActive}
                      className={`${compact ? 'p-1.5' : 'p-2'} rounded-lg transition-all cursor-pointer ${
                        isActive
                          ? 'bg-accent text-on-accent shadow-xs'
                          : actsNow
                            ? 'text-gold dark:text-gold bg-gold/10 ring-1 ring-gold/40'
                            : isDark
                              ? 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                              : 'text-muted hover:bg-stone-100 hover:text-stone-800'
                      }`}
                    >
                      {/* Selected tools thicken as well as change colour. A single-weight icon
                          set could only recolour; this is what Phosphor's weights are for, and it
                          reads at a glance without another chip on an already busy row. */}
                      <Icon className="w-4 h-4" weight={isActive ? 'fill' : 'regular'} />
                    </button>
                  </HoverTooltip>
                  {hasChip ? (
                    <ToolChip
                      color={toolColors[id] ?? NEUTRAL_COLORS[0]}
                      themes={settings.activeThemes}
                      customColors={settings.customColors}
                      onColorChange={(c, themeId) => {
                        onToolColorChange(id, c);
                        // Picking a theme's own swatch here should be indistinguishable from
                        // picking that theme in the strip below — both set what this tool draws
                        // AND what new marks get filed under, so a mark made right after never
                        // ends up coloured like one theme while tagged as another.
                        if (themeId) onThemeChange(themeId);
                      }}
                      isDark={isDark}
                      label={label}
                      weight={strokes ? toolWeights[id] : undefined}
                      onWeightChange={strokes ? (w) => onToolWeightChange(id, w) : undefined}
                      strokeStyle={strokes ? toolStrokeStyles[id] : undefined}
                      onStrokeStyleChange={strokes ? (s) => onToolStrokeStyleChange(id, s) : undefined}
                      noteStyle={id === 'note' ? noteStyle : undefined}
                      onNoteStyleChange={id === 'note' ? onNoteStyleChange : undefined}
                      bracketSide={id === 'bracket' ? bracketSide : undefined}
                      onBracketSideChange={id === 'bracket' ? onBracketSideChange : undefined}
                      textSize={id === 'text' ? textSize : undefined}
                      onTextSizeChange={id === 'text' ? onTextSizeChange : undefined}
                      textAlign={id === 'text' ? textAlign : undefined}
                      onTextAlignChange={id === 'text' ? onTextAlignChange : undefined}
                      textFont={id === 'text' ? textFont : undefined}
                      onTextFontChange={id === 'text' ? onTextFontChange : undefined}
                      textBold={id === 'text' ? textBold : undefined}
                      onTextBoldChange={id === 'text' ? onTextBoldChange : undefined}
                      textItalic={id === 'text' ? textItalic : undefined}
                      onTextItalicChange={id === 'text' ? onTextItalicChange : undefined}
                      forceOpen={openSubmenuFor === id}
                      onOpenChange={(isOpen) => onSubmenuOpenChange?.(id, isOpen)}
                      onForceHandled={onSubmenuOpened}
                    />
                  ) : (
                    <span className="h-2.5" />
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}

        <div className={`w-px h-6 mx-0.5 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />

        {/* Undo and redo. Every edit goes through one history, so this covers drawing, moving,
            restyling, erasing and writing alike — not just the drawing tools. */}
        <div className="flex items-center gap-0.5">
          <HoverTooltip label={`Undo (${MODIFIER}Z)`}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onUndo}
              disabled={!canUndo}
              aria-label="Undo"
              className="p-2 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-800 dark:hover:text-stone-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          </HoverTooltip>
          <HoverTooltip label={`Redo (${SHIFT_MODIFIER}Z)`}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onRedo}
              disabled={!canRedo}
              aria-label="Redo"
              className="p-2 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-800 dark:hover:text-stone-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </HoverTooltip>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <HoverTooltip label="Previous page">
            <button
              type="button"
              onClick={() => onGoToPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          </HoverTooltip>
          <span className="text-[12px] tabular-nums text-stone-600 dark:text-stone-400 px-1 select-none">
            {currentPage} / {pageCount || '—'}
          </span>
          <HoverTooltip label="Next page">
            <button
              type="button"
              onClick={() => onGoToPage(Math.min(pageCount, currentPage + 1))}
              disabled={currentPage >= pageCount}
              className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </HoverTooltip>
        </div>

        <div className={`w-px h-6 mx-0.5 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />

        <div className="flex items-center gap-0.5">
          <HoverTooltip label="Zoom out">
            <button type="button" onClick={() => stepZoom(-1)} className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
              <ZoomOut className="w-4 h-4" />
            </button>
          </HoverTooltip>
          <span className="text-[12px] tabular-nums text-stone-600 dark:text-stone-400 w-11 text-center select-none">
            {Math.round(scale * 100)}%
          </span>
          <HoverTooltip label="Zoom in">
            <button type="button" onClick={() => stepZoom(1)} className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
              <ZoomIn className="w-4 h-4" />
            </button>
          </HoverTooltip>
          <HoverTooltip label="Fit to width">
            <button type="button" onClick={onFitWidth} className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
              <Maximize2 className="w-4 h-4" />
            </button>
          </HoverTooltip>
        </div>

        <div className={`w-px h-6 mx-0.5 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />

        {/* Pages in view: 1, a 2-page spread (turns like a book), or 4 / 6 zoomed out. */}
        <div role="radiogroup" aria-label="Pages in view" className={`flex items-center rounded-lg p-0.5 ${isDark ? 'bg-stone-800/60' : 'bg-stone-100'}`}>
          {(
            [
              { mode: 'single', n: '1', label: 'One page' },
              { mode: 'spread', n: '2', label: 'Two-page spread (← → or swipe to turn)' },
              { mode: 'grid4', n: '4', label: 'Four pages' },
              { mode: 'grid6', n: '6', label: 'Six pages' }
            ] as const
          ).map((o) => (
            <HoverTooltip key={o.mode} label={o.label}>
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === o.mode}
                aria-label={o.label}
                onClick={() => onViewModeChange(o.mode)}
                className={`min-w-6 h-6 px-1 rounded-md text-[11.5px] font-spine cursor-pointer ${
                  viewMode === o.mode
                    ? 'bg-accent text-on-accent shadow-xs'
                    : isDark
                      ? 'text-stone-400 hover:text-stone-200'
                      : 'text-muted hover:text-stone-800'
                }`}
              >
                {o.n}
              </button>
            </HoverTooltip>
          ))}
        </div>

        <HoverTooltip label="Insert or delete a page">
          <button
            type="button"
            onClick={onInsertPage}
            className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
          >
            <FilePlus2 className="w-4 h-4" />
          </button>
        </HoverTooltip>

        <div className={`w-px h-6 mx-0.5 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />

        <ExportMenu onExport={onExport} isExporting={isExporting} rows={archiveRows} isDark={isDark} />

        {markCount > 0 && (
          <HoverTooltip label="Marks saved on this computer">
          <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-gold/10 text-gold dark:text-gold select-none">
            {markCount}
          </span>
          </HoverTooltip>
        )}

        {panelControls && (
          <>
            <div className={`w-px h-6 mx-0.5 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />
            {panelControls}
          </>
        )}
        {/* A little air after the last control, so it is not flush against the window edge when
            the row is scrolled to its end. */}
        <span aria-hidden className="w-1" />
      </div>

      {/* Themes. The per-tool chips above set style; this row sets which theme a new mark is
          FILED under, and as a convenience recolours the current tool to match. Scrolls
          horizontally with snap points, rather than wrapping across lines, once there are more
          themes than fit — a name beside every dot is worth the width; the row just stops
          claiming a second line of the toolbar to fit them all at once. */}
      <div
        ref={themeStripRef}
        className={`chip-strip flex items-center gap-1.5 px-3 py-2 border-t text-[11.5px] overflow-x-auto snap-x snap-mandatory scroll-smooth ${
          isDark ? 'border-stone-800' : 'border-stone-100'
        }`}
      >
        <span className="caps caps-sm text-muted mr-1 shrink-0">
          Theme
        </span>

        {settings.activeThemes.map((theme, i) => {
          const isActive = activeThemeId === theme.id;
          return (
            <button
              key={theme.id}
              data-theme-id={theme.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onThemeChange(theme.id);
                if (tool !== 'erase' && tool !== 'select') onToolColorChange(tool, theme.color);
              }}
              title={withShortcut(`File new marks under "${theme.name}"`, themeShortcut(i))}
              aria-keyshortcuts={themeShortcut(i)}
              aria-pressed={isActive}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg font-medium transition-all cursor-pointer shrink-0 snap-start ${
                isActive
                  ? 'bg-stone-200/90 dark:bg-nav-active text-stone-900 dark:text-nav-active-fg dark:shadow-[inset_0_0_0_1px_var(--nav-active-ring)]'
                  : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-nav-hover dark:hover:text-paper'
              }`}
            >
              <span
                className={`w-3 h-3 rounded-full border border-black/10 shrink-0 ${isInkOnDark(theme.color) ? DARK_SWATCH_RING : ''}`}
                style={{ backgroundColor: theme.color }}
              />
              <span className="whitespace-nowrap">{theme.name}</span>
            </button>
          );
        })}

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onThemeChange(null)}
          title="New marks are not filed under any theme"
          aria-pressed={activeThemeId === null}
          className={`px-2 py-1 rounded-lg font-medium transition-all cursor-pointer shrink-0 snap-start whitespace-nowrap ${
            activeThemeId === null
              ? 'bg-stone-200/90 dark:bg-nav-active text-stone-900 dark:text-nav-active-fg dark:shadow-[inset_0_0_0_1px_var(--nav-active-ring)]'
              : 'text-muted dark:text-paper/70 hover:bg-stone-100 dark:hover:bg-nav-hover dark:hover:text-paper'
          }`}
        >
          Untagged
        </button>
      </div>
    </div>
  );
};
