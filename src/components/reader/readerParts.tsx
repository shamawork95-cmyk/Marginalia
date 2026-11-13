/**
 * The text reader's constants and types, and the components it draws each paragraph with: a margin
 * note card and the paragraph itself (moved verbatim from ReaderScreen).
 */

import React from 'react';
import {
  StickyNote as StickyNoteIcon,
  Plus,
  Trash2,
  Pencil,
  Highlighter,
  Underline,
  Strikethrough,
  Tag
} from '../icons';
import { noteTimeLabel } from '../../hooks/noteTimestamp';
import { type TextMark, type TextMarkKind } from '../../utils/textMarks';
import { markColor, segmentParagraph } from '../../utils/textMarkView';
import { markFill } from '../../utils/markFill';
import { styleRuns } from '../textStyleRuns';
import { type TextStyle } from '../../utils/pastedText';
import {
  DEFAULT_TEXT_SIZE,
  REACTION_KINDS,
  reactionChar,
  type AnnotationKind
} from '../pdf/annotationModel';
import { plural } from '../../utils/plural';
import { ExtraThemeDots } from '../ExtraThemeDots';

export const PARA_TEXT_ID_PREFIX = 'reader-para-text-';
/** The instance navigator pill plus its gap, kept clear by the popovers (as in the PDF workspace). */
export const NAVIGATOR_HEIGHT = 60;
export const FALLBACK_COLOR = '#8b5cf6';
export const IS_APPLE = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
export const MODIFIER = IS_APPLE ? '⌘' : 'Ctrl+';
export const SHIFT_MODIFIER = IS_APPLE ? '⇧⌘' : 'Ctrl+Shift+';

/** The text tools a reader can arm, so the next selection is marked straight away. */
export type TextTool = 'select' | 'highlight' | 'underline' | 'strikeout' | 'terminology';
export const TEXT_TOOLS: { id: Exclude<TextTool, 'select'>; label: string; icon: React.ElementType }[] = [
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikeout', label: 'Strikeout', icon: Strikethrough },
  { id: 'terminology', label: 'Terminology', icon: Tag }
];

export const isReactionKind = (kind: TextMarkKind) => (REACTION_KINDS as readonly string[]).includes(kind);
/** PDF weights are fractions of page width; the properties strip draws them at 620 px a unit. */
export const weightPx = (w: number | undefined) => (w ? Math.max(1, w * 620) : 2);

export type Tab = 'notes' | 'board' | 'export';
export const TAB_INDEXES: Record<Tab, number> = { notes: 0, board: 1, export: 2 };

export const tabVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0, scale: 0.98 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0, scale: 0.98 })
};

/** A note card and the words it cites, as the paragraph draws it. */
export interface NoteItem {
  mark: TextMark;
  quote: string | undefined;
}

/** What a paragraph can do to the reader; one stable object, so it never breaks the memo. */
export interface ParagraphActions {
  markClick: (e: React.MouseEvent, id: string) => void;
  hover: (id: string | null) => void;
  edit: (id: string) => void;
  remove: (id: string) => void;
  /** Opens or closes a note pinned in the narrow margin (null closes). */
  togglePin: (id: string | null) => void;
  addNote: (idx: number) => void;
  activate: (idx: number) => void;
}

export interface ParagraphProps {
  idx: number;
  text: string;
  /** This paragraph's marks, the same array between renders while none of them changed. */
  marks: TextMark[];
  /** Ids of the mark heads that start here with something drawn before them (a reaction's glyph,
   *  the dots of a mark under several themes), space-separated. */
  glyphHeads: string;
  /** The reader's themes, for those dots. */
  themes: { id: string; name: string; color: string }[];
  notes: NoteItem[];
  /** Ids of this paragraph's marks that are selected, or hovered (whole groups), space-separated. */
  selKey: string;
  hovKey: string;
  isActive: boolean;
  isDark: boolean;
  /**
   * How notes sit in the margin: 'cards' beside the text (wide window), 'pins' in a narrow gutter
   * that open the card on tap (phone, or a panel taking the room), 'off' when hidden.
   */
  margin: MarginMode;
  /** The pinned note open in the narrow gutter, if it belongs to this paragraph. */
  openPin: string;
  /** Pasted custom text keeps its own line breaks and indentation. */
  verbatim: boolean;
  /** Pasted base formatting for this paragraph (bold, italic, underline), drawn under the marks. */
  styles: TextStyle[];
  terminologyColor: string;
  fontFamily: string;
  fontSize: number;
  /** From the paragraph's own script: right-to-left text runs right to left, Urdu is set in Nastaliq. */
  dir: 'rtl' | 'ltr';
  lineHeight: string;
  /** Minute tick for the notes' relative times; 0 for paragraphs without notes. */
  clock: number;
  actions: ParagraphActions;
}

export type MarginMode = 'cards' | 'pins' | 'off';
/** Margin column for note cards: a 1.5rem gap plus a 15rem card. */
export const MARGIN_CARDS_PX = 264;
/** Narrow gutter for pins: a 24px pin plus its gap. */
export const MARGIN_PINS_PX = 30;
/** The text column wants at least this much beside a margin of cards, or pins are used instead. */
export const MIN_TEXT_PX = 520;
export const EMPTY_MARKS: TextMark[] = [];
export const EMPTY_STYLES: TextStyle[] = [];
export const RUN_STYLE: Record<string, React.CSSProperties> = {
  bold: { fontWeight: 700 },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline', textUnderlineOffset: '3px' }
};
export const EMPTY_NOTES: NoteItem[] = [];

export const noteSurface = (c: string, m: TextMark): React.CSSProperties => {
  const style = m.noteStyle ?? 'outline';
  if (style === 'solid') return { backgroundColor: `${c}47`, borderColor: c };
  if (style === 'translucent') return { backgroundColor: `${c}1f`, borderColor: `${c}66` };
  return { borderColor: c };
};

/** A sticky note card, beside its line in the margin (or opened from a margin pin). */
export const NoteCard: React.FC<{
  note: TextMark;
  quote: string | undefined;
  color: string;
  on: boolean;
  isDark: boolean;
  label: string;
  time: string | null | undefined;
  actions: ParagraphActions;
}> = ({ note, quote, color, on, isDark, label, time, actions }) => (
  <div
    data-note-card={note.id}
    data-mark-ui
    onMouseEnter={() => actions.hover(note.id)}
    onMouseLeave={() => actions.hover(null)}
    onClick={(e) => actions.markClick(e, note.id)}
    className={`p-3 rounded-xl border shadow-xs transition-shadow cursor-pointer text-stone-900 dark:text-stone-100 ${
      isDark ? 'bg-night-3' : 'bg-white'
    } ${on ? 'shadow-md' : ''}`}
    style={{ ...noteSurface(color, note), borderWidth: on ? 2 : 1.5 }}
  >
    <div className="flex items-start justify-between gap-2 mb-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <StickyNoteIcon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
        <h4 dir="auto" className="font-semibold text-[12.5px] tracking-tight truncate">{label}</h4>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.edit(note.id);
          }}
          className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-stone-900 dark:hover:text-white cursor-pointer"
          title="Edit the note"
          aria-label="Edit the note"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.remove(note.id);
          }}
          className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-red-600 cursor-pointer"
          title="Delete this mark"
          aria-label="Delete this mark"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
    {quote && (
      <div dir="auto" className="text-[11px] italic text-stone-600 dark:text-stone-400 border-s-2 ps-2 my-1.5 leading-snug line-clamp-3" style={{ borderInlineStartColor: color }}>
        &ldquo;{quote}&rdquo;
      </div>
    )}
    {note.text && <p dir="auto" className="text-[12px] leading-relaxed whitespace-pre-wrap break-words">{note.text}</p>}
    {/* Only the time on the reader's own notes; a teacher's (from a class pack) is signed. */}
    {(time || note.fromClassPack) && (
      <p className="mt-1 text-right text-[10px] text-muted">
        {note.fromClassPack && note.author ? `${note.author}${time ? ' · ' : ''}` : ''}
        {time}
      </p>
    )}
  </div>
);

/**
 * One paragraph: its text cut into marked pieces, its note button and its margin notes.
 * Memoised: it re-renders only when its own marks, notes or selected/hovered ids change, so
 * pointing at one mark in a 3,000-paragraph book redraws one or two paragraphs, not all of them.
 */
export const Paragraph = React.memo(function Paragraph({
  idx,
  text,
  marks: paraMarks,
  glyphHeads,
  themes,
  notes,
  selKey,
  hovKey,
  isActive,
  isDark,
  margin,
  openPin,
  verbatim,
  styles,
  terminologyColor,
  fontFamily,
  fontSize,
  dir,
  lineHeight,
  clock,
  actions
}: ParagraphProps) {
  const selected = selKey ? new Set(selKey.split(' ')) : null;
  const hovered = hovKey ? new Set(hovKey.split(' ')) : null;
  const isOn = (id: string) => Boolean(selected?.has(id) || hovered?.has(id));
  const colorOf = (m: TextMark) => (m.isTerminology ? terminologyColor : markColor(m.color, FALLBACK_COLOR));

  /** Text from `start` to `end` with its pasted base formatting; offsets are unchanged. */
  const styled = (start: number, end: number): React.ReactNode =>
    styles.length
      ? styleRuns(start, end, styles).map((r) =>
          r.styles.length ? (
            <span key={r.start} style={Object.assign({}, ...r.styles.map((k) => RUN_STYLE[k]))}>
              {text.slice(r.start, r.end)}
            </span>
          ) : (
            text.slice(r.start, r.end)
          )
        )
      : text.slice(start, end);

  const renderText = (): React.ReactNode => {
    if (!paraMarks.length) return styled(0, text.length);
    const byId = new Map(paraMarks.map((m) => [m.id, m]));
    const heads = glyphHeads ? new Set(glyphHeads.split(' ')) : null;
    return segmentParagraph(text.length, paraMarks).map((seg) => {
      const here = seg.ids.map((id) => byId.get(id)!);
      // A reaction's glyph sits before its passage: an empty button with a CSS glyph, so the
      // paragraph's text (and every offset counted from it) is unchanged.
      const startsHere = paraMarks.filter((m) => heads?.has(m.id) && m.anchor.start === seg.start && m.anchor.end > m.anchor.start);
      // A mark under several themes: a dot per other theme before its words (no text, so offsets hold).
      const dotNodes = startsHere
        .filter((m) => !isReactionKind(m.kind) && (m.themeIds?.length ?? 0) > 1)
        .map((m) => <ExtraThemeDots key={`d-${m.id}`} themeIds={m.themeIds} themes={themes} className="align-super mr-[2px]" />);
      const glyphNodes = [...dotNodes, ...startsHere
        .filter((m) => isReactionKind(m.kind))
        .map((m) => {
          const color = colorOf(m);
          return (
            <button
              key={`g-${m.id}`}
              type="button"
              data-mark-ui
              data-mark-ids={m.id}
              data-glyph={reactionChar(m.kind as AnnotationKind)}
              aria-label={`${m.kind === 'question' ? 'Question mark' : m.kind === 'star' ? 'Asterisk' : 'Exclamation mark'} on “${(m.quote || text.slice(m.anchor.start, m.anchor.end)).slice(0, 40)}”`}
              onClick={(e) => actions.markClick(e, m.id)}
              className="inline-block align-baseline mx-0.5 px-0.5 rounded font-extrabold leading-none select-none cursor-pointer before:content-[attr(data-glyph)]"
              style={{
                color: isDark && color.toLowerCase() === '#000000' ? 'var(--color-paper)' : color,
                fontSize: `${Math.round((m.fontSize ?? DEFAULT_TEXT_SIZE) * 700)}px`,
                outline: isOn(m.id) ? `2px solid ${color}` : undefined
              }}
            />
          );
        })];

      const visible = here.filter((m) => !isReactionKind(m.kind));
      const anyReaction = here.some((m) => isReactionKind(m.kind));
      if (visible.length === 0 && !(anyReaction && here.some((m) => isOn(m.id)))) {
        return (
          <React.Fragment key={seg.start}>
            {glyphNodes}
            {styled(seg.start, seg.end)}
          </React.Fragment>
        );
      }

      // `<mark>` is yellow by default; a piece with no highlight must stay unfilled.
      const style: React.CSSProperties = { color: 'inherit', backgroundColor: 'transparent', borderRadius: 2 };
      const lines: string[] = [];
      let decoColor = '';
      // Words under highlights of several themes show every theme's colour, in bands.
      const fills: string[] = [];
      for (const m of here) {
        const c = colorOf(m);
        if (m.kind === 'highlight') {
          style.backgroundColor = markFill(c, isDark);
          if (!fills.includes(style.backgroundColor)) fills.push(style.backgroundColor);
        }
        else if (m.kind === 'underline' || m.kind === 'strikeout') {
          lines.push(m.kind === 'underline' ? 'underline' : 'line-through');
          if (m.kind === 'underline' || !decoColor) decoColor = c;
          style.textDecorationStyle = m.strokeStyle ?? 'solid';
          style.textDecorationThickness = `${weightPx(m.weight)}px`;
        } else if (m.kind === 'bold') style.fontWeight = 700;
        else if (m.kind === 'circle') {
          style.border = `${m.thickness || 2}px solid ${c}`;
          style.borderRadius = '50% / 30%';
          style.padding = '0.05em 0.4em';
        } else if (m.kind === 'note') {
          // A note lights up the words it is about, the way a highlight does, plus its dotted rule.
          if (style.backgroundColor === 'transparent') style.backgroundColor = markFill(c, isDark);
          if (!style.border) style.borderBottom = `2px dotted ${c}`;
        }
      }
      if (fills.length > 1) {
        const step = 100 / fills.length;
        style.backgroundImage = `linear-gradient(to bottom, ${fills.map((f, i) => `${f} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
        // The bands alone: a fill under them would tint every band with the last colour.
        style.backgroundColor = 'transparent';
      }
      if (lines.length) {
        style.textDecorationLine = lines.join(' ');
        style.textDecorationColor = decoColor;
        style.textUnderlineOffset = '5px';
      }
      const top = visible[visible.length - 1] ?? here[here.length - 1];
      const topColor = colorOf(top);
      if (hovered && here.some((m) => hovered.has(m.id))) style.backgroundColor = markFill(topColor, isDark, 'hover');
      if (selected && here.some((m) => selected.has(m.id))) {
        style.outline = `2px solid ${topColor}`;
        style.outlineOffset = 1;
      }
      return (
        <React.Fragment key={seg.start}>
          {glyphNodes}
          <mark
            data-mark-ui
            data-mark-ids={seg.ids.join(' ')}
            onClick={(e) => actions.markClick(e, top.id)}
            className="cursor-pointer"
            style={style}
          >
            {styled(seg.start, seg.end)}
          </mark>
        </React.Fragment>
      );
    });
  };

  const now = new Date(clock || Date.now());
  return (
    <div
      id={`reader-para-${idx}`}
      onClick={() => actions.activate(idx)}
      className={`relative group rounded-xl p-2.5 -mx-2.5 transition-all ${
        isActive ? 'bg-amber-500/5 ring-1 ring-amber-500/30' : 'hover:bg-black/2 dark:hover:bg-white/2'
      }`}
    >
      <p
        id={`${PARA_TEXT_ID_PREFIX}${idx}`}
        dir={dir}
        className="leading-relaxed text-stone-800 dark:text-stone-200"
        style={{ fontFamily, fontSize: `${fontSize}px`, lineHeight, whiteSpace: verbatim ? 'pre-wrap' : undefined }}
      >
        {renderText()}
      </p>

      <div className="mt-2 flex items-center justify-between opacity-75 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          data-para-note
          onClick={(e) => {
            e.stopPropagation();
            actions.addNote(idx);
          }}
          className="text-[11px] font-medium text-stone-600 dark:text-stone-400 hover:text-gold dark:hover:text-gold flex items-center gap-1 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-gold" />
          <span>Note</span>
        </button>
        {notes.length > 0 && (
          // Gold on its own 10% tint: 4.78:1 on paper; the dark gold is lighter still on night.
          <span className="text-[10px] font-semibold text-gold bg-gold/10 px-2 py-0.5 rounded-full">
            {plural(notes.length, 'note')}
          </span>
        )}
      </div>

      {/* Notes in the margin, level with the line they were written about. `top` is set by the
          reader's margin layout pass (see `layoutMargin`), which also keeps cards from overlapping. */}
      {margin !== 'off' &&
        notes.map(({ mark: note, quote }) => {
          const color = colorOf(note);
          const on = isOn(note.id);
          const label = note.title || 'Reader Note';
          if (margin === 'pins') {
            const open = openPin === note.id;
            return (
              <div key={note.id} data-margin-item={note.id} className="absolute left-full ml-1.5 top-0 w-6">
                <button
                  type="button"
                  data-note-card={note.id}
                  data-mark-ui
                  aria-expanded={open}
                  aria-label={`Note: ${label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.togglePin(open ? null : note.id);
                  }}
                  className={`w-6 h-6 -mt-0.5 flex items-center justify-center rounded-md border cursor-pointer transition-colors ${
                    isDark ? 'bg-night-3' : 'bg-white'
                  } ${open || on ? 'shadow-md' : 'shadow-xs'}`}
                  style={{ borderColor: color }}
                >
                  <StickyNoteIcon className="w-3.5 h-3.5" style={{ color }} weight={open ? 'fill' : 'regular'} />
                </button>
                {open && (
                  <div className="absolute right-0 top-7 z-20 w-[min(18rem,calc(100vw-3rem))]">
                    <NoteCard note={note} quote={quote} color={color} on isDark={isDark} label={label} time={noteTimeLabel(note, now)} actions={actions} />
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={note.id} data-margin-item={note.id} className="absolute left-full ml-6 top-0 w-60">
              {/* Drawn by the layout pass only when the card had to move down off its line: a thin
                  rule from the line, across the gutter, to the card. */}
              <svg data-margin-link aria-hidden className="absolute -left-6 w-6 overflow-visible pointer-events-none" style={{ display: 'none', color }}>
                <path fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity="0.6" vectorEffect="non-scaling-stroke" />
              </svg>
              <NoteCard note={note} quote={quote} color={color} on={on} isDark={isDark} label={label} time={noteTimeLabel(note, now)} actions={actions} />
            </div>
          );
        })}
    </div>
  );
});
