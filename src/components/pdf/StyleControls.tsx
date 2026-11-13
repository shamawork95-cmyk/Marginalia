/**
 * The style pickers, in one place.
 *
 * Every one of these appears twice: in a tool's dropdown on the main toolbar, where it sets what
 * the NEXT mark will look like, and in the properties strip beside a selected mark, where it
 * restyles the mark that is already there. Writing each control once is what keeps that promise
 * — two hand-written copies of a dash-style picker drift apart the first time an option is added
 * to one of them, and the reader is the one who finds out.
 */

import React from 'react';
import {
  BracketSide,
  NoteStyle,
  StrokeStyle,
  TEXT_FONTS,
  TEXT_SIZE_STEPS,
  TextAlign,
  TextFont,
  fontStack
} from './annotationModel';
import { UserSettings } from '../../types';
import { HoverTooltip } from '../HoverTooltip';
import { Check } from '../icons';
import { themeShortcut, withShortcut } from './workspaceKeys';

/** Neutral colours for marks that are not thematic — a correction, a stray arrow. */
export const NEUTRAL_COLORS = ['#1c1917', '#6b7280', '#dc2626'];

/** Stroke weights offered, as fractions of page width — so they scale with the page, not the window. */
export const WEIGHT_STEPS: { label: string; value: number }[] = [
  { label: 'Fine', value: 0.0015 },
  { label: 'Medium', value: 0.0028 },
  { label: 'Bold', value: 0.0045 },
  { label: 'Heavy', value: 0.007 }
];

/*
 * Dark-mode tile colours, shared by every picker. On the night pill the glyphs are cream, not the
 * mark's colour (a black mark's swatches vanished on it): rest cream/70 (8.3:1 on night-3), hover
 * full cream on nav-hover (13.6:1), selected = the nav's active chip with its inner ring, full
 * cream (10.0:1). Light mode keeps the mark's colour and the stone tiles.
 */
const DARK_ON = 'dark:bg-nav-active dark:text-nav-active-fg dark:shadow-[inset_0_0_0_1px_var(--nav-active-ring)]';
const DARK_OFF = 'dark:text-paper/70 dark:hover:text-paper dark:hover:bg-nav-hover';
const tile = (active: boolean) => (active ? `bg-stone-200 ${DARK_ON}` : `hover:bg-stone-100 ${DARK_OFF}`);
const textTile = (active: boolean) =>
  active ? `bg-stone-200 text-stone-900 ${DARK_ON}` : `text-muted hover:bg-stone-100 ${DARK_OFF}`;

/**
 * True when a colour would vanish on the dark pill (under 3:1 against night-3, i.e. relative
 * luminance below ~0.121). Such swatches get a cream ring in dark mode so they read as a dot.
 * Non-hex values are assumed readable.
 */
/** The check on a theme swatch that is on: dark on a light swatch, cream on a dark one. */
const ThemeCheck: React.FC<{ color: string }> = ({ color }) => {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  const light = m ? [0, 2, 4].reduce((sum, i, k) => sum + parseInt(m[1].slice(i, i + 2), 16) * [0.299, 0.587, 0.114][k], 0) > 150 : true;
  return <Check aria-hidden className="w-3 h-3" weight="bold" style={{ color: light ? '#1c1917' : '#f6f1e7' }} />;
};

export const isInkOnDark = (color: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.121;
};

/** Cream ring that lets a near-black swatch read as a dot on the dark pill (4.8:1 against it). */
export const DARK_SWATCH_RING = 'dark:ring-1 dark:ring-paper/50';

const segment = (active: boolean) =>
  `px-2 h-6 rounded-md flex items-center justify-center gap-1 text-[10.5px] font-semibold transition-colors cursor-pointer ${textTile(active)}`;

export const Divider: React.FC<{ isDark: boolean; className?: string }> = ({ isDark, className = '' }) => (
  <div className={`w-px h-5 mx-0.5 shrink-0 ${isDark ? 'bg-stone-700' : 'bg-stone-200'} ${className}`} />
);

/**
 * The theme colours, the reader's own, the neutrals, and a full picker for anything else.
 *
 * The reader's colours sit between the themes and the neutrals rather than behind a submenu,
 * because the point of defining them is to reach them in one press. Every mark kind — including a
 * sticky note, wherever it's recoloured — shows the same theme set first, kept to colour alone
 * (name on hover) so a reader with several themes still sees the whole row at once; the dividers
 * are what keep "theme", "your own colour" and "plain, untagged colour" from blurring together.
 */
export const ColorPalette: React.FC<{
  color: string;
  themes: UserSettings['activeThemes'];
  customColors?: string[];
  /**
   * A mark's themes: its theme swatches then toggle (several themes per mark), each one on shows
   * ringed and checked. Absent (a tool's colour), a swatch is one choice among the rest.
   */
  themeIds?: string[];
  /**
   * Fires with the theme's own id when a theme swatch is picked, `null` for anything else (a
   * custom colour, a neutral, or the free picker). Colour and theme have to change together — a
   * mark's `color` is decorative, `themeId` is what the tagging system and the cross-document
   * dashboard actually count, and the two silently drifting apart (a mark visibly recoloured to
   * match a theme whose id it was never given) is exactly the "book vanished from its theme" bug
   * this shape exists to rule out.
   */
  onChange: (color: string, themeId: string | null) => void;
}> = ({ color, themes, themeIds, customColors = [], onChange }) => {
  const swatch = (value: string, label: string, themeId: string | null = null) => {
    const on = themeIds ? (themeId ? themeIds.includes(themeId) : themeIds.length === 0 && color.toLowerCase() === value.toLowerCase()) : color.toLowerCase() === value.toLowerCase();
    return (
    <HoverTooltip key={value} label={label}>
      <button
        type="button"
        // Keeps a live text selection alive — pressing this must not discard what the reader is
        // about to mark.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange(value, themeId)}
        aria-label={themeId ? `Theme: ${label}` : `${label} ${value}`}
        aria-pressed={on}
        className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer shrink-0 flex items-center justify-center ${
          on ? 'border-stone-800 dark:border-white' : 'border-transparent'
        } ${isInkOnDark(value) ? DARK_SWATCH_RING : ''}`}
        style={{ backgroundColor: value }}
      >
        {themeIds && themeId && on && <ThemeCheck color={value} />}
      </button>
    </HoverTooltip>
    );
  };

  return (
    <div className="flex items-center gap-1">
      {themes.map((theme, i) => swatch(theme.color, withShortcut(theme.name, themeShortcut(i)), theme.id))}
      {themes.length > 0 && customColors.length > 0 && (
        <span className="w-px h-4 bg-stone-200 dark:bg-stone-700 mx-0.5 shrink-0" aria-hidden />
      )}
      {customColors.map((c) => swatch(c, 'Your colour'))}
      {customColors.length > 0 && (
        <span className="w-px h-4 bg-stone-200 dark:bg-stone-700 mx-0.5 shrink-0" aria-hidden />
      )}
      {NEUTRAL_COLORS.map((c) => swatch(c, 'Untagged colour'))}
      <HoverTooltip label="Custom colour">
        <label
          className="w-5 h-5 rounded-full border border-black/15 dark:border-white/25 cursor-pointer overflow-hidden shrink-0"
          style={{ background: 'conic-gradient(#ef4444,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444)' }}
        >
          <input
            type="color"
            aria-label="Custom colour"
            value={color}
            onChange={(e) => onChange(e.target.value, null)}
            className="opacity-0 w-full h-full cursor-pointer"
          />
        </label>
      </HoverTooltip>
    </div>
  );
};

/** Thickness, shown as swatches drawn at the weight they set. */
export const WeightPicker: React.FC<{
  weight?: number;
  color: string;
  onChange: (weight: number) => void;
  /** Pixels per unit weight, so the swatch reads at the size of the surface it sits on. */
  swatchScale?: number;
}> = ({ weight, color, onChange, swatchScale = 900 }) => (
  <div className="flex items-center gap-0.5">
    {WEIGHT_STEPS.map((step) => (
      <button
        key={step.value}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange(step.value)}
        title={`${step.label} thickness`}
        className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
          tile(weight === step.value)
        }`}
      >
        {/* The swatch IS the weight, drawn at the size it will draw at (cream in dark mode). */}
        <span
          className="block w-4 rounded-full bg-(--mark) dark:bg-current"
          style={{ height: Math.max(1, step.value * swatchScale), '--mark': color } as React.CSSProperties}
        />
      </button>
    ))}
  </div>
);

const STROKE_STYLES: { value: StrokeStyle; label: string; dash: string }[] = [
  { value: 'solid', label: 'Solid', dash: '' },
  { value: 'dashed', label: 'Dashed', dash: '5 3' },
  { value: 'dotted', label: 'Dotted', dash: '0.1 3.4' }
];

/** Solid, dashed or dotted — each shown as a specimen of the line it produces. */
export const StrokeStylePicker: React.FC<{
  value?: StrokeStyle;
  color: string;
  onChange: (style: StrokeStyle) => void;
}> = ({ value, color, onChange }) => (
  <div className="flex items-center gap-0.5">
    {STROKE_STYLES.map((option) => (
      <button
        key={option.value}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange(option.value)}
        title={`${option.label} line`}
        aria-label={`${option.label} line`}
        className={`w-7 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
          tile((value ?? 'solid') === option.value)
        }`}
      >
        <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden style={{ '--mark': color } as React.CSSProperties}>
          <line
            x1="1"
            y1="4"
            x2="17"
            y2="4"
            className="stroke-(--mark) dark:stroke-current"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={option.dash || undefined}
          />
        </svg>
      </button>
    ))}
  </div>
);

const NOTE_STYLES: { value: NoteStyle; label: string; hint: string }[] = [
  { value: 'outline', label: 'Paper', hint: 'Opaque paper with a coloured border' },
  { value: 'solid', label: 'Solid', hint: 'Filled with the mark’s colour' },
  { value: 'translucent', label: 'Tint', hint: 'Tinted, letting the page show through' }
];

/** How a sticky note is filled — each option previewed as a miniature of the note itself. */
export const NoteStylePicker: React.FC<{
  value?: NoteStyle;
  color: string;
  onChange: (style: NoteStyle) => void;
}> = ({ value, color, onChange }) => (
  <div className="flex items-center gap-0.5">
    {NOTE_STYLES.map((option) => {
      const active = (value ?? 'outline') === option.value;
      return (
        <button
          key={option.value}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(option.value)}
          title={option.hint}
          aria-label={option.label}
          className={`w-7 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
            tile(active)
          }`}
        >
          <span
            className={`block w-4 h-3.5 rounded-[2px] ${isInkOnDark(color) ? DARK_SWATCH_RING : ''}`}
            style={{
              background:
                option.value === 'solid' ? color : option.value === 'translucent' ? `${color}4d` : '#fffdf5',
              border: `1px solid ${color}`,
              borderLeftWidth: 3
            }}
          />
        </button>
      );
    })}
  </div>
);

/** Which way a curly bracket opens. */
export const BracketSidePicker: React.FC<{
  value?: BracketSide;
  onChange: (side: BracketSide) => void;
}> = ({ value, onChange }) => (
  <div className="flex items-center gap-0.5">
    {(['left', 'right'] as const).map((side) => (
      <button
        key={side}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange(side)}
        title={side === 'left' ? 'Opens to the right — for the left margin' : 'Opens to the left — for the right margin'}
        className={segment((value ?? 'left') === side)}
      >
        <span className="font-mono text-[13px] leading-none">{side === 'left' ? '{' : '}'}</span>
      </button>
    ))}
  </div>
);

/** Type size for a text box, each option previewed as a letter at its own relative size. */
export const TextSizePicker: React.FC<{
  value?: number;
  color: string;
  onChange: (size: number) => void;
}> = ({ value, color, onChange }) => (
  <div className="flex items-end gap-0.5">
    {TEXT_SIZE_STEPS.map((step, index) => (
      <button
        key={step.value}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange(step.value)}
        title={`${step.label} text`}
        aria-label={`${step.label} text`}
        className={`w-6 h-6 rounded-md flex items-end justify-center pb-0.5 transition-colors cursor-pointer ${
          tile(value === step.value)
        }`}
      >
        <span
          className="text-(--mark) dark:text-current"
          style={{ '--mark': color, fontSize: 8 + index * 3, lineHeight: 1, fontWeight: 600 } as React.CSSProperties}
        >
          A
        </span>
      </button>
    ))}
  </div>
);

const ALIGNMENTS: { value: TextAlign; label: string; bars: number[] }[] = [
  { value: 'left', label: 'Align left', bars: [1, 0.6, 0.85, 0.5] },
  { value: 'center', label: 'Align centre', bars: [1, 0.6, 0.85, 0.5] },
  { value: 'right', label: 'Align right', bars: [1, 0.6, 0.85, 0.5] }
];

/** How a text box's lines are set, drawn as a miniature of the paragraph each produces. */
export const AlignPicker: React.FC<{
  value?: TextAlign;
  color: string;
  onChange: (align: TextAlign) => void;
}> = ({ value, color, onChange }) => (
  <div className="flex items-center gap-0.5">
    {ALIGNMENTS.map((option) => (
      <button
        key={option.value}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange(option.value)}
        title={option.label}
        aria-label={option.label}
        className={`w-6 h-6 rounded-md flex flex-col justify-center gap-[2px] px-1 transition-colors cursor-pointer ${
          tile((value ?? 'left') === option.value)
        }`}
        style={{ '--mark': color } as React.CSSProperties}
      >
        {option.bars.map((width, i) => (
          <span
            key={i}
            className="block h-[1.5px] rounded-full bg-(--mark) dark:bg-current"
            style={{
              width: `${width * 100}%`,
              // The bars ARE the alignment: ragged on the side the text is not set against.
              alignSelf:
                option.value === 'left' ? 'flex-start' : option.value === 'right' ? 'flex-end' : 'center'
            }}
          />
        ))}
      </button>
    ))}
  </div>
);

/** Typeface for a text box, each option set in the face it selects. */
export const FontPicker: React.FC<{
  value?: TextFont;
  onChange: (font: TextFont) => void;
}> = ({ value, onChange }) => (
  <div className="flex items-center gap-0.5">
    {TEXT_FONTS.map((font) => (
      <button
        key={font.value}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange(font.value)}
        title={`${font.label} typeface`}
        aria-label={`${font.label} typeface`}
        className={`h-6 px-1.5 rounded-md flex items-center justify-center text-[12px] transition-colors cursor-pointer ${
          textTile((value ?? 'sans') === font.value)
        }`}
        // The specimen IS the choice: each button is set in the face it selects.
        style={{ fontFamily: font.stack }}
      >
        Aa
      </button>
    ))}
  </div>
);

/** Bold and italic, as independent toggles. */
export const EmphasisPicker: React.FC<{
  bold?: boolean;
  italic?: boolean;
  onBoldChange: (bold: boolean) => void;
  onItalicChange: (italic: boolean) => void;
}> = ({ bold, italic, onBoldChange, onItalicChange }) => {
  const button = (active: boolean, label: string, onClick: () => void, style: React.CSSProperties) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`w-6 h-6 rounded-md flex items-center justify-center text-[12px] transition-colors cursor-pointer ${textTile(
        active
      )}`}
      style={style}
    >
      {label[0]}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5">
      {button(Boolean(bold), 'Bold', () => onBoldChange(!bold), { fontWeight: 700 })}
      {button(Boolean(italic), 'Italic', () => onItalicChange(!italic), { fontStyle: 'italic', fontFamily: 'Georgia, serif' })}
    </div>
  );
};
