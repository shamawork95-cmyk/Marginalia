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
  Eraser,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronUp,
  ChevronDown,
  Download,
  Loader2
} from 'lucide-react';
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
  EmphasisPicker,
  FontPicker,
  Divider,
  NEUTRAL_COLORS,
  NoteStylePicker,
  StrokeStylePicker,
  TextSizePicker,
  WeightPicker
} from './StyleControls';
import { useDismiss } from './useDismiss';
import { UserSettings } from '../../types';

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
  markCount: number;
  onExport: () => void;
  isExporting: boolean;
  isDark?: boolean;
}

const TOOL_GROUPS: { id: PdfTool; label: string; icon: React.ElementType; hint: string }[][] = [
  [
    // Select: the resting state. Text is freely selectable, marks can be picked, nothing is
    // drawn. Returning to it is how you stop a drawing tool being armed.
    { id: 'select', label: 'Select', icon: MousePointer2, hint: 'Select text and marks, and drag marks around' },
    { id: 'highlight', label: 'Highlight', icon: Highlighter, hint: 'Select text to highlight it' },
    { id: 'underline', label: 'Underline', icon: Underline, hint: 'Select text to underline it' },
    { id: 'strikeout', label: 'Strikeout', icon: Strikethrough, hint: 'Select text to strike it out' }
  ],
  [
    { id: 'ink', label: 'Pen', icon: PenLine, hint: 'Draw freehand' },
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
  onColorChange: (color: string) => void;
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

  // Closing on any press outside, and on Escape, is shared with every other floating surface in
  // the workspace — see `useDismiss` for why it listens for pointerdown rather than click.
  useDismiss(ref, open, () => setOpen(false));

  return (
    // The menu closes only on a press outside or on Escape — never on picking an option, so
    // several can be tried in a row and each change is seen on the page.
    <div ref={ref} className="relative flex justify-center">
      <button
        type="button"
        // Keeps a live text selection alive — pressing this must not discard what the reader is
        // about to mark.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title={`${label} options`}
        aria-label={`${label} options`}
        aria-expanded={open}
        className="w-6 h-2.5 rounded-full border border-black/15 dark:border-white/25 cursor-pointer transition-transform hover:scale-110"
        style={{ backgroundColor: color }}
      />

      {open && (
        <div
          ref={menuRef}
          className={`fixed z-50 p-2 rounded-xl shadow-xl border flex items-center gap-1.5 ${
            isDark ? 'bg-[#1b201d] border-stone-700' : 'bg-white border-stone-200'
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
        </div>
      )}
    </div>
  );
};

/** Zoom stops, so the buttons step through predictable sizes rather than drifting by a factor. */
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
  markCount,
  onExport,
  isExporting,
  isDark = false
}) => {
  const stepZoom = (direction: 1 | -1) => {
    const index = ZOOM_STEPS.findIndex((s) => s >= scale - 0.001);
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, (index === -1 ? 2 : index) + direction));
    onScaleChange(ZOOM_STEPS[next]);
  };

  return (
    <div
      className={`flex flex-col shrink-0 border-b ${
        isDark ? 'bg-[#181c19] border-stone-800' : 'bg-white border-stone-200'
      }`}
    >
      {/* Tools, undo, zoom and pages */}
      <div className="flex items-center gap-1 flex-wrap px-3 py-2">
        {TOOL_GROUPS.map((group, groupIndex) => (
          <React.Fragment key={groupIndex}>
            {groupIndex > 0 && <div className={`w-px h-6 mx-1 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />}
            {group.map(({ id, label, icon: Icon, hint }) => {
              const isActive = tool === id;
              // A text tool with text already selected will act on that selection right now, so
              // it says so rather than describing what happens after the next drag.
              const actsNow = hasSelection && isTextAnchored(id as never);
              // Only tools that actually draw carry a style chip.
              const hasChip = id !== 'erase' && id !== 'select';
              // Everything drawn with a stroke gets a thickness and a dash pattern. Highlight is
              // the exception: it fills the line box rather than stroking, so it has neither.
              const strokes = isStroked(id as never);
              return (
                <div key={id} className="flex flex-col items-center gap-0.5">
                  <button
                    type="button"
                    // Pressing a button moves focus, which would clear the text selection before
                    // the click handler ever ran. Suppressing the default keeps the selection
                    // alive — and visible — so tapping the tool can apply to it.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onToolChange(id)}
                    title={actsNow ? `${label} the selected text (tap again to undo)` : hint}
                    aria-label={label}
                    aria-pressed={isActive}
                    className={`p-2 rounded-lg transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#435c52] text-white shadow-xs'
                        : actsNow
                          ? 'text-[#435c52] dark:text-emerald-300 bg-emerald-500/10 ring-1 ring-emerald-500/40'
                          : isDark
                            ? 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                            : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                  {hasChip ? (
                    <ToolChip
                      color={toolColors[id] ?? NEUTRAL_COLORS[0]}
                      themes={settings.activeThemes}
                      customColors={settings.customColors}
                      onColorChange={(c) => onToolColorChange(id, c)}
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

        <div className={`w-px h-6 mx-1 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />

        {/* Undo and redo. Every edit goes through one history, so this covers drawing, moving,
            restyling, erasing and writing alike — not just the drawing tools. */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            aria-label="Undo"
            className="p-2 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-800 dark:hover:text-stone-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
            className="p-2 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-800 dark:hover:text-stone-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onGoToPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            title="Previous page"
            className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <span className="text-[12px] tabular-nums text-stone-600 dark:text-stone-400 px-1 select-none">
            {currentPage} / {pageCount || '—'}
          </span>
          <button
            type="button"
            onClick={() => onGoToPage(Math.min(pageCount, currentPage + 1))}
            disabled={currentPage >= pageCount}
            title="Next page"
            className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        <div className={`w-px h-6 mx-1 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />

        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => stepZoom(-1)} title="Zoom out" className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[12px] tabular-nums text-stone-600 dark:text-stone-400 w-11 text-center select-none">
            {Math.round(scale * 100)}%
          </span>
          <button type="button" onClick={() => stepZoom(1)} title="Zoom in" className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button type="button" onClick={onFitWidth} title="Fit to width" className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        <div className={`w-px h-6 mx-1 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />

        <button
          type="button"
          onClick={onExport}
          disabled={isExporting}
          title="Export a PDF with your marks embedded as real PDF annotations"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50"
        >
          {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span className="hidden lg:inline">Export PDF</span>
        </button>

        {markCount > 0 && (
          <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 select-none" title="Marks saved on this computer">
            {markCount}
          </span>
        )}
      </div>

      {/* Themes. The per-tool chips above set style; this row sets which theme a new mark is
          FILED under, and as a convenience recolours the current tool to match. */}
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 flex-wrap border-t text-[11.5px] ${
          isDark ? 'border-stone-800' : 'border-stone-100'
        }`}
      >
        <span className="text-[10px] font-semibold tracking-wider uppercase text-stone-400 mr-1">Theme</span>

        {settings.activeThemes.map((theme) => {
          const isActive = activeThemeId === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onThemeChange(theme.id);
                if (tool !== 'erase' && tool !== 'select') onToolColorChange(tool, theme.color);
              }}
              title={`File new marks under "${theme.name}"`}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-stone-200/90 dark:bg-stone-700 text-stone-900 dark:text-white'
                  : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full border border-black/10 shrink-0"
                style={{ backgroundColor: theme.color }}
              />
              <span>{theme.name}</span>
            </button>
          );
        })}

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onThemeChange(null)}
          title="New marks are not filed under any theme"
          className={`px-2 py-1 rounded-lg font-medium transition-all cursor-pointer ${
            activeThemeId === null
              ? 'bg-stone-200/90 dark:bg-stone-700 text-stone-900 dark:text-white'
              : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800'
          }`}
        >
          Untagged
        </button>
      </div>
    </div>
  );
};
