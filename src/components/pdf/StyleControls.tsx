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

/** Neutral colours for marks that are not thematic — a correction, a stray arrow. */
export const NEUTRAL_COLORS = ['#1c1917', '#6b7280', '#dc2626'];

/** Stroke weights offered, as fractions of page width — so they scale with the page, not the window. */
export const WEIGHT_STEPS: { label: string; value: number }[] = [
  { label: 'Fine', value: 0.0015 },
  { label: 'Medium', value: 0.0028 },
  { label: 'Bold', value: 0.0045 },
  { label: 'Heavy', value: 0.007 }
];

const segment = (active: boolean) =>
  `px-2 h-6 rounded-md flex items-center justify-center gap-1 text-[10.5px] font-semibold transition-colors cursor-pointer ${
    active ? 'bg-stone-200 dark:bg-stone-700 text-stone-900 dark:text-white' : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800'
  }`;

export const Divider: React.FC<{ isDark: boolean }> = ({ isDark }) => (
  <div className={`w-px h-5 mx-0.5 shrink-0 ${isDark ? 'bg-stone-700' : 'bg-stone-200'}`} />
);

/**
 * The theme colours, the reader's own, the neutrals, and a full picker for anything else.
 *
 * The reader's colours sit between the themes and the neutrals rather than behind a submenu,
 * because the point of defining them is to reach them in one press.
 *
 * `onlyCustomColors` narrows this down to just the reader's own palette from Settings (plus the
 * manual picker, so an arbitrary colour is still reachable) — for the compact strip beside a
 * selected mark, where themes and neutrals would crowd out the colours the reader actually curated.
 */
export const ColorPalette: React.FC<{
  color: string;
  themes: UserSettings['activeThemes'];
  customColors?: string[];
  onlyCustomColors?: boolean;
  onChange: (color: string) => void;
}> = ({ color, themes, customColors = [], onlyCustomColors = false, onChange }) => {
  const swatch = (value: string, title: string) => (
    <button
      key={value}
      type="button"
      // Keeps a live text selection alive — pressing this must not discard what the reader is
      // about to mark.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onChange(value)}
      title={title}
      className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer shrink-0 ${
        color.toLowerCase() === value.toLowerCase() ? 'border-stone-800 dark:border-white' : 'border-transparent'
      }`}
      style={{ backgroundColor: value }}
    />
  );

  return (
    <div className="flex items-center gap-1">
      {!onlyCustomColors && themes.map((theme) => swatch(theme.color, theme.name))}
      {!onlyCustomColors && customColors.length > 0 && (
        <span className="w-px h-4 bg-stone-200 dark:bg-stone-700 mx-0.5 shrink-0" aria-hidden />
      )}
      {customColors.map((c) => swatch(c, 'Your colour'))}
      {!onlyCustomColors && NEUTRAL_COLORS.map((c) => swatch(c, 'Untagged colour'))}
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
          weight === step.value ? 'bg-stone-200 dark:bg-stone-700' : 'hover:bg-stone-100 dark:hover:bg-stone-800'
        }`}
      >
        {/* The swatch IS the weight, drawn at the size it will draw at. */}
        <span
          className="block w-4 rounded-full"
          style={{ height: Math.max(1, step.value * swatchScale), backgroundColor: color }}
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
          (value ?? 'solid') === option.value
            ? 'bg-stone-200 dark:bg-stone-700'
            : 'hover:bg-stone-100 dark:hover:bg-stone-800'
        }`}
      >
        <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden>
          <line
            x1="1"
            y1="4"
            x2="17"
            y2="4"
            stroke={color}
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
            active ? 'bg-stone-200 dark:bg-stone-700' : 'hover:bg-stone-100 dark:hover:bg-stone-800'
          }`}
        >
          <span
            className="block w-4 h-3.5 rounded-[2px]"
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
          value === step.value ? 'bg-stone-200 dark:bg-stone-700' : 'hover:bg-stone-100 dark:hover:bg-stone-800'
        }`}
      >
        <span style={{ color, fontSize: 8 + index * 3, lineHeight: 1, fontWeight: 600 }}>A</span>
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
          (value ?? 'left') === option.value
            ? 'bg-stone-200 dark:bg-stone-700'
            : 'hover:bg-stone-100 dark:hover:bg-stone-800'
        }`}
      >
        {option.bars.map((width, i) => (
          <span
            key={i}
            className="block h-[1.5px] rounded-full"
            style={{
              width: `${width * 100}%`,
              backgroundColor: color,
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
          (value ?? 'sans') === font.value
            ? 'bg-stone-200 dark:bg-stone-700 text-stone-900 dark:text-white'
            : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800'
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
      className={`w-6 h-6 rounded-md flex items-center justify-center text-[12px] transition-colors cursor-pointer ${
        active
          ? 'bg-stone-200 dark:bg-stone-700 text-stone-900 dark:text-white'
          : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800'
      }`}
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
