/**
 * The annotation toolbar: tools, the theme colour picker, zoom and page navigation.
 *
 * The colour picker is the theme picker. Choosing "Questions" sets both the colour and the theme
 * every new mark is filed under, so colour-coding is a consequence of marking rather than a step
 * afterwards — this is the whole reason for owning the annotation model.
 */

import React, { useEffect, useRef, useState } from 'react';
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
  Type,
  Eraser,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronUp,
  ChevronDown,
  Download,
  Loader2
} from 'lucide-react';
import { PdfTool, isTextAnchored } from './annotationModel';
import { UserSettings } from '../../types';

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
  /** Opens this tool's colour/thickness submenu — set after applying a tool from the selection menu. */
  openSubmenuFor?: string | null;
  onSubmenuOpened?: () => void;
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
    { id: 'select', label: 'Select', icon: MousePointer2, hint: 'Select text and marks — draws nothing' },
    { id: 'highlight', label: 'Highlight', icon: Highlighter, hint: 'Select text to highlight it' },
    { id: 'underline', label: 'Underline', icon: Underline, hint: 'Select text to underline it' },
    { id: 'strikeout', label: 'Strikeout', icon: Strikethrough, hint: 'Select text to strike it out' }
  ],
  [
    { id: 'ink', label: 'Pen', icon: PenLine, hint: 'Draw freehand' },
    { id: 'rect', label: 'Rectangle', icon: Square, hint: 'Drag a rectangle' },
    { id: 'ellipse', label: 'Ellipse', icon: Circle, hint: 'Drag an ellipse' },
    { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, hint: 'Drag to draw an arrow on the page' },
    { id: 'line', label: 'Line', icon: Minus, hint: 'Drag a line' }
  ],
  [
    { id: 'note', label: 'Note', icon: StickyNote, hint: 'Click to place a handwritten sticky note' },
    { id: 'text', label: 'Text box', icon: Type, hint: 'Drag a box, then type' },
    { id: 'erase', label: 'Erase', icon: Eraser, hint: 'Click a mark to delete it' }
  ]
];

/**
 * The colour chip beneath a tool, and the palette it opens.
 *
 * Each marking tool carries its own colour, so the chip both SHOWS what that tool will draw and
 * is the way to change it — no trip to a shared palette, and no ambiguity about which tool a
 * colour applies to.
 */
/** Stroke weights offered, as fractions of page width — so they scale with the page, not the window. */
export const WEIGHT_STEPS: { label: string; value: number }[] = [
  { label: 'Fine', value: 0.0015 },
  { label: 'Medium', value: 0.0028 },
  { label: 'Bold', value: 0.0045 },
  { label: 'Heavy', value: 0.007 }
];

const ColorChip: React.FC<{
  color: string;
  themes: UserSettings['activeThemes'];
  onChange: (color: string) => void;
  isDark: boolean;
  label: string;
  /** Present only for tools that stroke; text markup has no thickness to set. */
  weight?: number;
  onWeightChange?: (weight: number) => void;
  /** Opens the menu from outside — used when a tool is applied from the selection menu. */
  forceOpen?: boolean;
  onForceHandled?: () => void;
}> = ({ color, themes, onChange, isDark, label, weight, onWeightChange, forceOpen, onForceHandled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Opening is a one-shot request: it is acknowledged immediately so the menu can then be closed
  // normally rather than being forced back open on every render.
  useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    onForceHandled?.();
  }, [forceOpen, onForceHandled]);

  // Closes when the reader clicks anywhere else, which is what makes it feel like a menu rather
  // than a panel that has to be dismissed deliberately.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    // The menu closes only on a click outside or on Escape — never on picking a colour, so
    // several can be tried in a row and the change is seen on the page each time.
    <div
      ref={ref}
      className="relative flex justify-center"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        // Keeps a live text selection alive — pressing this must not discard what the reader is
        // about to mark.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title={`${label} colour`}
        aria-label={`${label} colour`}
        className="w-6 h-2.5 rounded-full border border-black/15 dark:border-white/25 cursor-pointer transition-transform hover:scale-110"
        style={{ backgroundColor: color }}
      />

      {open && (
        <div
          className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 p-2 rounded-xl shadow-xl border flex items-center gap-1.5 ${
            isDark ? 'bg-[#1b201d] border-stone-700' : 'bg-white border-stone-200'
          }`}
        >
          {themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(theme.color)}
              title={theme.name}
              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer ${
                color.toLowerCase() === theme.color.toLowerCase()
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(c)}
              title="Untagged colour"
              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer ${
                color.toLowerCase() === c.toLowerCase() ? 'border-stone-800 dark:border-white' : 'border-transparent'
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
              value={color}
              onChange={(e) => onChange(e.target.value)}
              className="opacity-0 w-full h-full cursor-pointer"
            />
          </label>

          {onWeightChange && (
            <>
              <div className={`w-px h-6 mx-0.5 ${isDark ? 'bg-stone-700' : 'bg-stone-200'}`} />
              <div className="flex items-center gap-1">
                {WEIGHT_STEPS.map((step) => (
                  <button
                    key={step.value}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onWeightChange(step.value)}
                    title={`${step.label} thickness`}
                    className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                      weight === step.value
                        ? 'bg-stone-200 dark:bg-stone-700'
                        : 'hover:bg-stone-100 dark:hover:bg-stone-800'
                    }`}
                  >
                    {/* The swatch IS the weight, drawn at the size it will draw at. */}
                    <span
                      className="block w-4 rounded-full"
                      style={{ height: Math.max(1, step.value * 1400), backgroundColor: color }}
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/** Zoom stops, so the buttons step through predictable sizes rather than drifting by a factor. */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** Neutral colours for marks that are not thematic — a correction, a stray arrow. */
export const NEUTRAL_COLORS = ['#1c1917', '#6b7280', '#dc2626'];

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
  openSubmenuFor,
  onSubmenuOpened,
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

  const showsColor = tool !== 'select' && tool !== 'erase';

  return (
    <div
      className={`flex flex-col shrink-0 border-b ${
        isDark ? 'bg-[#181c19] border-stone-800' : 'bg-white border-stone-200'
      }`}
    >
      {/* Tools, zoom and pages */}
      <div className="flex items-center gap-1 flex-wrap px-3 py-2">
        {TOOL_GROUPS.map((group, groupIndex) => (
          <React.Fragment key={groupIndex}>
            {groupIndex > 0 && <div className={`w-px h-6 mx-1 ${isDark ? 'bg-stone-800' : 'bg-stone-200'}`} />}
            {group.map(({ id, label, icon: Icon, hint }) => {
              const isActive = tool === id;
              // A text tool with text already selected will act on that selection right now, so
              // it says so rather than describing what happens after the next drag.
              const actsNow = hasSelection && isTextAnchored(id as never);
              // Only tools that actually draw carry a colour.
              const hasColor = id !== 'erase' && id !== 'select';
              // Everything drawn with a stroke gets a thickness. Highlight is the one exception:
              // it fills the line box rather than stroking, so there is no width to set.
              const strokes = ['ink', 'rect', 'ellipse', 'arrow', 'line', 'underline', 'strikeout'].includes(id);
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
                  {hasColor ? (
                    <ColorChip
                      color={toolColors[id] ?? NEUTRAL_COLORS[0]}
                      themes={settings.activeThemes}
                      onChange={(c) => onToolColorChange(id, c)}
                      isDark={isDark}
                      label={label}
                      weight={strokes ? toolWeights[id] : undefined}
                      onWeightChange={strokes ? (w) => onToolWeightChange(id, w) : undefined}
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

      {/* Themes. The per-tool chips above set colour; this row sets which theme a new mark is
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
