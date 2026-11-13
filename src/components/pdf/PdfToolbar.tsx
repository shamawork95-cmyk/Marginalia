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
  FitPage,
  ChevronUp,
  ChevronDown,
  AreaSelect,
  FilePlus2
} from '../icons';
import {
  BracketSide,
  type MaskMode,
  NoteStyle,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont,
  isStroked,
  isTextAnchored
} from './annotationModel';
import { DARK_SWATCH_RING, isInkOnDark, NEUTRAL_COLORS } from './StyleControls';
import { type ArchiveRow } from '../MarksArchive';
import { UserSettings } from '../../types';
import type { PdfViewMode } from '../../utils/documentStorage';
import { HoverTooltip } from '../HoverTooltip';
import { TOOL_HOTKEYS, themeShortcut, withShortcut } from './workspaceKeys';
import { ToolChip } from './toolbar/ToolChip';
import { MoreMenu, ExportMenu } from './toolbar/toolbarMenus';

export { NEUTRAL_COLORS, WEIGHT_STEPS } from './StyleControls';


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
  /** Black it out's mode: words, box or freehand. */
  maskMode?: MaskMode;
  onMaskModeChange?: (mode: MaskMode) => void;
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
  /** Fit page: the whole page (or the book's pair, or the grid) in the window. */
  onFitPage?: () => void;
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
    { id: 'mask', label: 'Black it out', icon: EyeOff, hint: 'Black out words, a box or a freehand stroke (choose in its options)' },
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
  maskMode,
  onMaskModeChange,
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
  onFitPage,
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

  const viewControls = (
    <>
          <div className="flex items-center gap-0.5">
            <HoverTooltip label="Previous page">
              <button
                type="button"
                onClick={() => onGoToPage(Math.max(1, currentPage - 1))}
                aria-label="Previous page"
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
                aria-label="Next page"
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
              <button type="button" onClick={() => stepZoom(-1)} aria-label="Zoom out" className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
                <ZoomOut className="w-4 h-4" />
              </button>
            </HoverTooltip>
            <span className="text-[12px] tabular-nums text-stone-600 dark:text-stone-400 w-11 text-center select-none">
              {Math.round(scale * 100)}%
            </span>
            <HoverTooltip label="Zoom in">
              <button type="button" onClick={() => stepZoom(1)} aria-label="Zoom in" className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
                <ZoomIn className="w-4 h-4" />
              </button>
            </HoverTooltip>
            <HoverTooltip label="Fit to width">
              <button type="button" onClick={onFitWidth} aria-label="Fit to width" className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
                <Maximize2 className="w-4 h-4" />
              </button>
            </HoverTooltip>
            {onFitPage && (
              <HoverTooltip label="Fit page">
                <button type="button" onClick={onFitPage} aria-label="Fit page" className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
                  <FitPage className="w-4 h-4" />
                </button>
              </HoverTooltip>
            )}
          </div>

          <div className={`w-px h-6 mx-0.5 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />

          {/* Pages in view: 1, a 2-page spread (turns like a book), or 4 / 6 zoomed out. */}
          <div role="radiogroup" aria-label="Pages in view" className={`flex items-center rounded-lg p-0.5 ${isDark ? 'bg-stone-800/60' : 'bg-stone-100'}`}>
            {(
              [
                { mode: 'single', n: '1', label: '1 page' },
                { mode: 'spread', n: '2', label: '2 pages, as a book (← → or swipe to turn)' },
                { mode: 'grid4', n: '4', label: '4 pages (2×2)' },
                { mode: 'grid6', n: '6', label: '6 pages (3×2)' }
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
              aria-label="Insert or delete a page"
              className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
            >
              <FilePlus2 className="w-4 h-4" />
            </button>
          </HoverTooltip>

    </>
  );

  /**
   * Folding the view controls into "More": when the row's natural width is wider than the row,
   * measured with the controls inline (and remembered, so the row unfolds once it fits again).
   */
  const rowRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [foldView, setFoldView] = useState(false);
  /** Still too narrow once folded (the 900 px minimum window, a panel open): the row wraps. */
  const [wrapRow, setWrapRow] = useState(false);
  const inlineWidth = useRef(0);
  const foldedWidth = useRef(0);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const check = () => {
      if (!foldView) inlineWidth.current = row.scrollWidth;
      else if (!wrapRow) foldedWidth.current = row.scrollWidth;
      const fold = row.clientWidth < inlineWidth.current - 1;
      const wrap = fold && row.clientWidth < foldedWidth.current - 1;
      if (fold !== foldView) setFoldView(fold);
      if (wrap !== wrapRow) setWrapRow(wrap);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(row);
    return () => observer.disconnect();
  }, [foldView, wrapRow, panelControls, markCount]);

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
        ref={rowRef}
        className={`flex items-center ${wrapRow ? 'flex-wrap gap-y-1.5' : 'flex-nowrap'} py-2 overflow-x-auto hide-scrollbar [&>*]:shrink-0 ${
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
                      maskMode={id === 'mask' ? maskMode : undefined}
                      onMaskModeChange={id === 'mask' ? onMaskModeChange : undefined}
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

        {/* Pages, zoom, pages in view and insert page: in the row when it has room, else behind
            "More", so Export, Find, Marks and Focus never slide off the right edge. */}
        {foldView ? (
          <MoreMenu isDark={isDark}>{viewControls}</MoreMenu>
        ) : (
          <div ref={viewRef} className="flex items-center gap-1">
            {viewControls}
          </div>
        )}

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
