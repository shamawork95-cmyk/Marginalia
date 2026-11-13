/**
 * The menu that appears next to a text selection.
 *
 * This is the fastest path from "I want to mark this" to a mark: select, then choose. It also
 * carries the only way to create a sticky note ABOUT a passage — the note is placed beside the
 * text and remembers which passage it belongs to, which is what lets hovering it light the
 * passage back up.
 *
 * Rendered in the shared `AnchoredPopover`: above the selection by default so the next line stays
 * readable, below near the top edge, clamped to the window and wrapped onto two rows on a narrow
 * one (themes on the first, actions on the second). Every action names its shortcut.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { registerThemeField } from './themeField';
import { Highlighter, Underline, Strikethrough, StickyNote, Tag, X, Plus, Check, Quote } from '../icons';
import { THEME_COLOR_PALETTES, nextFreeColor, type ThemeResult } from '../themeStore';
import { AnnotationKind, REACTION_KINDS, reactionChar } from './annotationModel';
import { UserSettings } from '../../types';
import { HoverTooltip } from '../HoverTooltip';
import { AnchoredPopover, PopoverDivider, PopoverGroup, popoverActionClass, PanelContext } from './AnchoredPopover';
import { DARK_SWATCH_RING, isInkOnDark } from './StyleControls';
import { TOOL_HOTKEYS, themeShortcut, withShortcut } from './workspaceKeys';

export interface SelectionAnchor {
  /** Viewport position of the selection, used to place the menu. */
  left: number;
  top: number;
  bottom: number;
}

export interface SelectionPopoverProps {
  anchor: SelectionAnchor | null;
  isDark?: boolean;
  /** Pixels at the top of the window this menu must stay clear of — the toolbar. */
  topInset?: number;
  /** Pixels at the foot of the window this menu must stay clear of — the instance navigator. */
  bottomInset?: number;
  /** Colour each text tool will use, so the menu shows what it is about to do. */
  toolColors: Record<string, string>;
  themes: UserSettings['activeThemes'];
  /** The themes every action below files under, main (the colour) first. */
  activeThemeIds: string[];
  /** Turns a theme on or off for every action below: one passage can be filed under several. */
  onThemeChange: (id: string) => void;
  onMark: (kind: AnnotationKind) => void;
  onCreateNote: () => void;
  /** Marks the selection as a terminology term — always in `terminologyColor`, set in
   *  Settings → Terminology rather than chosen per-mark. */
  onMarkTerminology: () => void;
  terminologyColor: string;
  onDismiss: () => void;
  /** Elements the menu should not cover when the other side of the selection is free. */
  avoidSelector?: string;
  /** Glyphs to keep clear and free places to use (the reader's; see `placePanel`). */
  placementContext?: () => PanelContext;
  /**
   * The X button specifically. Unlike `onDismiss` (outside click / Escape, which must leave the
   * selection intact for whatever the reader is reaching for next), pressing X means "I'm done
   * with this passage" — so it also clears the selection, the same as Mark and Sticky note do.
   * Without that, the global mouseup listener that re-opens this menu on an active selection would
   * see the selection was never cleared and pop the menu right back open.
   */
  onClose: () => void;
  /** "+ New theme": files the passage under a theme made right here. Absent, the button is not shown. */
  onCreateTheme?: (name: string, color: string) => ThemeResult;
  /** Copies the selection as `"quote" (Title, p. N)`. Resolves false when the clipboard failed. */
  onCopyQuote?: () => Promise<boolean>;
}

const ACTIONS: { kind: AnnotationKind; label: string; icon: React.ElementType }[] = [
  { kind: 'highlight', label: 'Highlight', icon: Highlighter },
  { kind: 'underline', label: 'Underline', icon: Underline },
  { kind: 'strikeout', label: 'Strikeout', icon: Strikethrough }
];

/**
 * Question mark, asterisk and exclamation mark — a one-tap reaction to a passage rather than a
 * style applied to it. Icon-only, unlike the marks above: the accessible name carries the name,
 * but the button itself shows only the symbol.
 */
const REACTION_LABELS: Record<string, string> = {
  question: 'Question mark',
  star: 'Asterisk',
  exclamation: 'Exclamation mark'
};

/**
 * The theme dots: which themes the next mark is filed under. Each toggles on or off, so a passage
 * can go under several at once; the first one on gives the mark its colour. Each dot is named for
 * screen readers (pressed when on) and teaches its number key.
 */
export const ThemeDots: React.FC<{
  themes: UserSettings['activeThemes'];
  activeThemeIds: string[];
  onThemeChange: (id: string) => void;
  /** Also name the active themes after the dots, so the next mark's themes are never a guess. */
  showActiveName?: boolean;
}> = ({ themes, activeThemeIds, onThemeChange, showActiveName = false }) => {
  const names = activeThemeIds.map((id) => themes.find((t) => t.id === id)?.name).filter(Boolean);
  return (
  <>
    {themes.map((theme, i) => {
      const name = withShortcut(theme.name, themeShortcut(i));
      const on = activeThemeIds.includes(theme.id);
      return (
        <HoverTooltip key={theme.id} label={on ? `${name} (on)` : name}>
          <button
            type="button"
            onClick={() => onThemeChange(theme.id)}
            aria-label={`Theme: ${name}`}
            aria-pressed={on}
            aria-keyshortcuts={themeShortcut(i)}
            // A 20px dot inside a 28px target: easy to hit, still reads as a dot.
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full cursor-pointer group/dot"
          >
            <span
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-transform duration-150 ease-out group-hover/dot:scale-110 ${
                on ? 'border-stone-800 dark:border-white' : 'border-transparent'
              } ${isInkOnDark(theme.color) ? DARK_SWATCH_RING : ''}`}
              style={{ backgroundColor: theme.color }}
            >
              {on && <Check aria-hidden className="w-3 h-3" weight="bold" style={{ color: checkInk(theme.color) }} />}
            </span>
          </button>
        </HoverTooltip>
      );
    })}
    {showActiveName && (
      <span className="px-1 max-w-[10rem] truncate text-[11.5px] font-semibold text-stone-700 dark:text-stone-200" aria-live="polite">
        {names.length ? names.join(' + ') : 'No theme'}
      </span>
    )}
  </>
  );
};

/** Ink for the check on a swatch: dark on a light colour, cream on a dark one. */
const checkInk = (color: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  const light = m ? [0, 2, 4].reduce((sum, i, k) => sum + parseInt(m[1].slice(i, i + 2), 16) * [0.299, 0.587, 0.114][k], 0) > 150 : true;
  return light ? '#1c1917' : '#f6f1e7';
};

/**
 * "+ New theme" inside the pop-over: a name and a colour, then the new theme becomes the active
 * one. Typing moves the browser's selection into the field, so the passage is kept (the reader
 * ignores selection changes inside `[data-keep-selection]`) and put back when the field closes.
 */
export const ThemeQuickCreate: React.FC<{
  themes: UserSettings['activeThemes'];
  isDark: boolean;
  /** The passage, to put back as the selection when the field closes. */
  selection: Range | null;
  onCreate: (name: string, color: string) => ThemeResult;
  /** Closes the field; `id` is the theme just made, if one was. */
  onDone: (id?: string) => void;
}> = ({ themes, isDark, selection, onCreate, onDone }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState(() => nextFreeColor(themes));
  // The suggested colour (never close to an existing theme) leads the swatches when it is not one of them.
  const [swatches] = useState(() => {
    const suggested = nextFreeColor(themes);
    const base = THEME_COLOR_PALETTES.mindful;
    return base.some((c) => c.hex.toLowerCase() === suggested.toLowerCase()) ? base : [{ name: 'Suggested colour', hex: suggested }, ...base];
  });
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(selection);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Focus first (so the reader and the workspace, which ignore selection changes inside
   * `[data-keep-selection]`, keep the passage), then let go of the page's selection. While the
   * passage stayed selected in the text layer, keystrokes went there and the field looked focused
   * but stayed empty until it was clicked.
   */
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    window.getSelection()?.removeAllRanges();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);
  // The latest name and colour, for a commit from outside (a toolbar mark while the field is open).
  const latest = useRef({ name, color });
  latest.current = { name, color };
  useEffect(
    () =>
      registerThemeField(() => {
        if (!latest.current.name.trim()) return null;
        const r = onCreate(latest.current.name, latest.current.color);
        if ('error' in r) {
          setError(r.error);
          return null;
        }
        onDone(r.theme.id);
        return { id: r.theme.id, color: r.theme.color };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useEffect(
    () => () => {
      const range = saved.current;
      if (!range) return;
      const now = window.getSelection();
      now?.removeAllRanges();
      now?.addRange(range);
    },
    []
  );
  const submit = () => {
    const r = onCreate(name, color);
    if ('error' in r) return setError(r.error);
    onDone(r.theme.id);
  };

  return (
    // One row, in place of the tools while it is open, so the menu stays small enough to sit
    // clear of the text.
    <div data-keep-selection className="flex flex-wrap items-center gap-x-1 gap-y-0.5 max-w-[calc(100vw-32px)]">
        <span className="w-3 h-3 ml-1.5 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: color }} aria-hidden />
        <input
          ref={inputRef}
          value={name}
          aria-label="New theme name"
          aria-invalid={Boolean(error)}
          placeholder="New theme name"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onDone();
            // Typing here is text: no shortcut, and Escape closes only this field.
            e.stopPropagation();
          }}
          className={`w-40 min-w-0 h-8 px-2.5 rounded-lg border text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-gold ${
            isDark ? 'bg-night-1 border-stone-600 text-paper placeholder:text-stone-400' : 'bg-white border-stone-300 text-ink placeholder:text-stone-500'
          }`}
        />
      <div role="radiogroup" aria-label="New theme colour" className="flex items-center">
        {swatches.map((c) => (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={color === c.hex}
            aria-label={c.name}
            title={c.name}
            onClick={() => setColor(c.hex)}
            className="w-7 h-7 flex items-center justify-center rounded-full cursor-pointer"
          >
            <span
              className={`w-4.5 h-4.5 rounded-full border-2 ${color === c.hex ? 'border-stone-800 dark:border-white' : 'border-transparent'}`}
              style={{ backgroundColor: c.hex }}
            />
          </button>
        ))}
      </div>
        <HoverTooltip label="Create theme (Enter)">
          <button type="button" onClick={submit} aria-label="Create theme" className={`${iconAction} text-gold`}>
            <Check className="w-4 h-4" weight="bold" />
          </button>
        </HoverTooltip>
        <HoverTooltip label="Cancel (Esc)">
          <button type="button" onClick={() => onDone()} aria-label="Cancel new theme" className={`${iconAction} text-muted`}>
            <X className="w-3.5 h-3.5" />
          </button>
        </HoverTooltip>
      {error && (
        <p role="alert" className="basis-full text-[12px] text-red-700 dark:text-red-300 px-1.5 pb-0.5">
          {error}
        </p>
      )}
    </div>
  );
};

/** A square icon-only action: 32px, the popover's tap target. */
const iconAction =
  'flex items-center justify-center w-8 h-8 rounded-lg hover:bg-stone-100 dark:hover:bg-nav-hover cursor-pointer';

export const SelectionPopover: React.FC<SelectionPopoverProps> = ({
  anchor,
  isDark = false,
  topInset = 0,
  bottomInset = 0,
  toolColors,
  themes,
  activeThemeIds,
  onThemeChange,
  onMark,
  onCreateNote,
  onMarkTerminology,
  terminologyColor,
  onDismiss,
  avoidSelector,
  placementContext,
  onClose,
  onCreateTheme,
  onCopyQuote
}) => {
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<null | boolean>(null);
  useEffect(() => {
    if (copied === null) return;
    const t = window.setTimeout(() => setCopied(null), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);
  const savedRange = useRef<Range | null>(null);
  // A menu that closed takes its half-made theme with it.
  const closed = !anchor;
  useEffect(() => {
    if (closed) setCreating(false);
  }, [closed]);
  // A near-black tool colour would vanish on the dark pill, so its icon turns cream there.
  const glyph = (color: string) => (isDark && isInkOnDark(color) ? 'var(--color-paper)' : color);

  return (
    <AnchoredPopover
      anchor={anchor}
      label="Mark the selection"
      isDark={isDark}
      onDismiss={onDismiss}
      topInset={topInset}
      bottomInset={bottomInset}
      measureKey={`${themes.length}${creating}`}
      avoidSelector={avoidSelector}
      placementContext={placementContext}
      // While "+ New theme" is open, pressing a mark tool must not close the menu first: the tool
      // creates the typed theme and marks the passage with it (see themeField.ts).
      ignoreSelector={creating ? '[data-mark-tool]' : undefined}
      className="gap-x-0.5 gap-y-1 p-1"
    >
      {onCreateTheme && creating ? (
        <ThemeQuickCreate
          themes={themes}
          isDark={isDark}
          selection={savedRange.current}
          onCreate={onCreateTheme}
          onDone={(id) => {
            setCreating(false);
            // The theme just made is turned on, beside any already on.
            if (id && !activeThemeIds.includes(id)) onThemeChange(id);
          }}
        />
      ) : (
        <>
      {themes.length > 0 && (
        // Below 640px the dots and the close button take the first row and the actions the
        // second, so nothing runs off the edge. Row two: 4 tools 128 + reactions 106 + Sticky
        // note 110 = 344 of 366 at 390px; under 360px the note drops its label (266 of 296 at 320).
        <PopoverGroup className={onCopyQuote ? 'max-sm:basis-[calc(100%-4.5rem)]' : 'max-sm:basis-[calc(100%-2.25rem)]'}>
          <ThemeDots themes={themes} activeThemeIds={activeThemeIds} onThemeChange={onThemeChange} showActiveName />
          {onCreateTheme && (
            <HoverTooltip label="New theme">
              <button
                type="button"
                onClick={() => {
                  // Kept now: the name field takes the browser's selection as soon as it mounts.
                  const sel = window.getSelection();
                  savedRange.current = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
                  setCreating(true);
                }}
                aria-label="New theme"
                                className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full cursor-pointer text-muted hover:text-ink dark:hover:text-paper hover:bg-stone-100 dark:hover:bg-nav-hover"
              >
                <span className="w-5 h-5 rounded-full border border-dashed border-current flex items-center justify-center">
                  <Plus className="w-3 h-3" weight="bold" />
                </span>
              </button>
            </HoverTooltip>
          )}
          <PopoverDivider isDark={isDark} className="max-sm:hidden" />
        </PopoverGroup>
      )}

      {/* The four marks are icons with drawn tooltips (the PDF toolbar's own glyphs), which keeps
          the menu about 480px wide on a desktop instead of running to the window edge. */}
      <PopoverGroup className="max-sm:order-2">
        {ACTIONS.map(({ kind, label, icon: Icon }) => {
          const name = withShortcut(label, TOOL_HOTKEYS[kind]);
          return (
            <HoverTooltip key={kind} label={name}>
              <button
                type="button"
                onClick={() => onMark(kind)}
                aria-label={name}
                aria-keyshortcuts={TOOL_HOTKEYS[kind]}
                className={iconAction}
              >
                <Icon className="w-4 h-4" style={{ color: glyph(toolColors[kind]) }} />
              </button>
            </HoverTooltip>
          );
        })}

        <HoverTooltip label="Mark as a terminology term">
          <button type="button" onClick={onMarkTerminology} aria-label="Mark as a terminology term" className={iconAction}>
            <Tag className="w-4 h-4" style={{ color: glyph(terminologyColor) }} />
          </button>
        </HoverTooltip>
      </PopoverGroup>

      <PopoverGroup className="max-sm:order-2">
        <PopoverDivider isDark={isDark} />
        {REACTION_KINDS.map((kind) => (
          <HoverTooltip key={kind} label={REACTION_LABELS[kind]}>
            <button type="button" onClick={() => onMark(kind)} aria-label={REACTION_LABELS[kind]} className={iconAction}>
              <span
                aria-hidden
                className="text-[16px] font-extrabold leading-none"
                style={{ color: glyph(toolColors[kind]) }}
              >
                {reactionChar(kind)}
              </span>
            </button>
          </HoverTooltip>
        ))}
      </PopoverGroup>

      {/* The rule before the note travels with it, so no rule is ever left at a row's end. */}
      <PopoverGroup className="max-sm:order-2">
        <PopoverDivider isDark={isDark} />
        <HoverTooltip label={withShortcut('Write a sticky note about this passage', TOOL_HOTKEYS.note)}>
          <button
            type="button"
            onClick={onCreateNote}
            aria-label={withShortcut('Sticky note', TOOL_HOTKEYS.note)}
            aria-keyshortcuts={TOOL_HOTKEYS.note}
            className={`${popoverActionClass} max-[359px]:px-2`}
          >
            <StickyNote className="w-3.5 h-3.5" style={{ color: glyph(toolColors.note) }} />
            <span className="max-[359px]:hidden">Sticky note</span>
          </button>
        </HoverTooltip>
      </PopoverGroup>

      {onCopyQuote && (
        // On a phone it rides on the first row, beside the close button (row two is full).
        <PopoverGroup className="max-sm:order-1">
          <PopoverDivider isDark={isDark} className="max-sm:hidden" />
          <HoverTooltip label={copied ? 'Copied with its reference' : copied === false ? 'Could not reach the clipboard' : 'Copy quote with its reference'}>
            <button
              type="button"
              onClick={() => void onCopyQuote().then(setCopied)}
              aria-label="Copy quote with its reference"
              className={iconAction}
            >
              {copied ? <Check className="w-4 h-4 text-gold" weight="bold" /> : <Quote className="w-4 h-4" />}
            </button>
          </HoverTooltip>
          {copied && (
            <span role="status" className="sr-only">
              Quote copied
            </span>
          )}
        </PopoverGroup>
      )}

      <PopoverGroup className="max-sm:order-1">
        <button
          type="button"
          onClick={onClose}
          title="Dismiss"
          aria-label="Dismiss"
          className="flex items-center justify-center w-8 h-8 rounded-lg text-muted dark:text-paper/70 hover:text-stone-700 dark:hover:text-paper cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </PopoverGroup>
        </>
      )}
    </AnchoredPopover>
  );
};
