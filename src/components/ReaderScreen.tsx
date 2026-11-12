import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  Settings as SettingsIcon,
  StickyNote as StickyNoteIcon,
  Plus,
  Trash2,
  Pencil,
  Highlighter,
  Underline,
  Strikethrough,
  Tag,
  Undo2,
  Redo2,
  PanelRightOpen,
  X,
  Download,
  BookOpen,
  Maximize2,
  Minimize2,
  Search,
  Feather,
  Board as BoardIcon
} from './icons';
import { paragraphTypeface, hasRtlText } from '../utils/scriptDirection';
import { analysePoem } from '../utils/poetry';
import { paragraphHits } from '../utils/motifTrace';
import { DEFAULT_POETRY, PoetryPanel, PROSODY_THEMES, usePoemOverlay } from './PoetryView';
import { paintHighlight, rangeFor, readPieces } from './findHighlight';
import { ExcerptBoard } from './ExcerptBoard';
import { printNotesPdf } from '../utils/documentStorage';
import nastaliqFontUrl from '@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff2?url';
import { TextSpread, MIN_SPREAD_WIDTH, type TextSpreadHandle } from './TextSpread';
import { ArchivePanel, archiveRows, copyText, excerpt, useMarksArchive } from './MarksArchive';
import { FindBar, FIND_SHORTCUT, useDocumentFind } from './FindBar';
import type { MarkLinks } from './pdf/MarkProperties';
import { formatQuoteRef, markLocation } from '../utils/quoteRef';
import { linkMarks, linkedIds, unlinkMarks } from '../utils/markLinks';
import { FocusChrome, FocusExit, FOCUS_HOTKEY } from './FocusMode';
import type { ThemeStore } from './themeStore';
import { AnnotationFocus, PoetryPrefs, ReaderJump, Screen, TransitionType, UserSettings } from '../types';
import { HoverTooltip } from './HoverTooltip';
import { ParagraphRange, rangesFromSelectionParts, selectionParagraphParts, selectionState } from '../utils/textFormatting';
import { noteTimeLabel } from '../hooks/noteTimestamp';
import type { PlainTextAnnotations } from '../hooks/usePlainTextAnnotations';
import { groupHeads, expandToGroups, type TextMark, type TextMarkKind } from '../utils/textMarks';
import { markColor, reuseUnchanged, segmentParagraph, textMarkViews, uncoveredRanges } from '../utils/textMarkView';
import { markFill } from '../utils/markFill';
import { inputKindOf, selectionTrigger, type InputKind } from '../utils/selectionTrigger';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { stackMargin } from './marginLayout';
import { styleRuns } from './textStyleRuns';
import { splitParagraphs, type TextStyle } from '../utils/pastedText';
import { fetchDocumentContent } from '../utils/documentStorage';
import { useReadingProgress } from '../hooks/useReadingProgress';
import { DEFAULT_TEXT_SIZE, REACTION_KINDS, reactionChar, type AnnotationKind } from './pdf/annotationModel';
import { SelectionPopover, SelectionAnchor } from './pdf/SelectionPopover';
import { MarkProperties } from './pdf/MarkProperties';
import type { PanelContext } from './pdf/useAnchoredPanel';
import { NotesList } from './pdf/NotesList';
import { InstanceNavigator } from './pdf/InstanceNavigator';
import { escapeConsumes, isTypingTarget, resolveWorkspaceKey, TOOL_HOTKEYS, withShortcut } from './pdf/workspaceKeys';

import {
  exportToPDF,
  notesPrintHtml,
  generateMarkdown,
  generatePlainText,
  downloadTextFile,
  getFilteredAnnotations,
  textMarksForExport,
  ExportOptions
} from '../utils/exportAnnotations';
import { plural } from '../utils/plural';

interface ReaderScreenProps {
  settings: UserSettings;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  documentText?: string;
  documentTitle?: string;
  /** Id in the local document store. Absent only for text from an old session that was never saved. */
  docId?: string;
  /** The document's marks, lifted to App so they survive navigating away and back. */
  annotations: PlainTextAnnotations;
  /** Focus mode: chrome hidden, the page alone (App owns it; F and Escape). */
  focusMode?: boolean;
  onToggleFocus?: () => void;
  /** Themes, for the selection menu's "+ New theme". */
  themeStore?: ThemeStore;
  /** Saves the two-page spread choice with the settings (on disk). */
  onSpreadChange?: (on: boolean) => void;
  /** Adds the themes a marks import brought with it. */
  onAddThemes?: (themes: UserSettings['activeThemes']) => void;
  /** Opened from the library to step through one theme's (or terminology's) marks. */
  focus?: AnnotationFocus;
  /** Opened from a motif trace: the passage to show and the words to paint. */
  jump?: ReaderJump;
  /** Saves reader preferences kept per document (the poetry view). */
  onUpdateSettings?: (update: (prev: UserSettings) => UserSettings) => void;
}

const PARA_TEXT_ID_PREFIX = 'reader-para-text-';
/** The instance navigator pill plus its gap, kept clear by the popovers (as in the PDF workspace). */
const NAVIGATOR_HEIGHT = 60;
const FALLBACK_COLOR = '#8b5cf6';
const IS_APPLE = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
const MODIFIER = IS_APPLE ? '⌘' : 'Ctrl+';
const SHIFT_MODIFIER = IS_APPLE ? '⇧⌘' : 'Ctrl+Shift+';

/** The text tools a reader can arm, so the next selection is marked straight away. */
type TextTool = 'select' | 'highlight' | 'underline' | 'strikeout' | 'terminology';
const TEXT_TOOLS: { id: Exclude<TextTool, 'select'>; label: string; icon: React.ElementType }[] = [
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikeout', label: 'Strikeout', icon: Strikethrough },
  { id: 'terminology', label: 'Terminology', icon: Tag }
];

const isReactionKind = (kind: TextMarkKind) => (REACTION_KINDS as readonly string[]).includes(kind);
/** PDF weights are fractions of page width; the properties strip draws them at 620 px a unit. */
const weightPx = (w: number | undefined) => (w ? Math.max(1, w * 620) : 2);

type Tab = 'notes' | 'board' | 'export';
const TAB_INDEXES: Record<Tab, number> = { notes: 0, board: 1, export: 2 };

const tabVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0, scale: 0.98 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0, scale: 0.98 })
};

/** A note card and the words it cites, as the paragraph draws it. */
interface NoteItem {
  mark: TextMark;
  quote: string | undefined;
}

/** What a paragraph can do to the reader; one stable object, so it never breaks the memo. */
interface ParagraphActions {
  markClick: (e: React.MouseEvent, id: string) => void;
  hover: (id: string | null) => void;
  edit: (id: string) => void;
  remove: (id: string) => void;
  /** Opens or closes a note pinned in the narrow margin (null closes). */
  togglePin: (id: string | null) => void;
  addNote: (idx: number) => void;
  activate: (idx: number) => void;
}

interface ParagraphProps {
  idx: number;
  text: string;
  /** This paragraph's marks, the same array between renders while none of them changed. */
  marks: TextMark[];
  /** Ids of the reaction heads drawn here as glyphs, space-separated. */
  glyphHeads: string;
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

type MarginMode = 'cards' | 'pins' | 'off';
/** Margin column for note cards: a 1.5rem gap plus a 15rem card. */
const MARGIN_CARDS_PX = 264;
/** Narrow gutter for pins: a 24px pin plus its gap. */
const MARGIN_PINS_PX = 30;
/** The text column wants at least this much beside a margin of cards, or pins are used instead. */
const MIN_TEXT_PX = 520;
const EMPTY_MARKS: TextMark[] = [];
const EMPTY_STYLES: TextStyle[] = [];
const RUN_STYLE: Record<string, React.CSSProperties> = {
  bold: { fontWeight: 700 },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline', textUnderlineOffset: '3px' }
};
const EMPTY_NOTES: NoteItem[] = [];

const noteSurface = (c: string, m: TextMark): React.CSSProperties => {
  const style = m.noteStyle ?? 'outline';
  if (style === 'solid') return { backgroundColor: `${c}47`, borderColor: c };
  if (style === 'translucent') return { backgroundColor: `${c}1f`, borderColor: `${c}66` };
  return { borderColor: c };
};

/** A sticky note card, beside its line in the margin (or opened from a margin pin). */
const NoteCard: React.FC<{
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
const Paragraph = React.memo(function Paragraph({
  idx,
  text,
  marks: paraMarks,
  glyphHeads,
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
      const glyphNodes = paraMarks
        .filter((m) => heads?.has(m.id) && m.anchor.start === seg.start && m.anchor.end > m.anchor.start)
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
        });

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

export const ReaderScreen: React.FC<ReaderScreenProps> = ({
  settings,
  onNavigate,
  isDark = false,
  documentText,
  documentTitle,
  docId,
  annotations,
  focus,
  focusMode = false,
  onToggleFocus,
  themeStore,
  onSpreadChange,
  onAddThemes,
  jump,
  onUpdateSettings
}) => {
  const { marks, selectedIds, canUndo, canRedo, addMarks, updateMarks, deleteMarks, select, clearSelection, undo, redo } =
    annotations;
  const reduceMotion = useReducedMotion();

  /**
   * The stored text with its layout and pasted formatting. Until it arrives a saved document shows
   * no paragraphs: split the default way first, a verbatim paste would put marks on the wrong lines.
   */
  const [content, setContent] = useState<{ text: string; layout?: 'verbatim'; textStyles?: TextStyle[] } | null>(null);
  /**
   * A failed fetch shows an error with Retry and no paragraphs, so nothing can be marked. Falling
   * back to the bare text would lose the layout and anchor marks to the wrong paragraphs.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (!docId) return;
    let live = true;
    setLoadFailed(false);
    void fetchDocumentContent(docId).then((c) => {
      if (!live) return;
      if (c) setContent(c);
      else setLoadFailed(true);
    });
    return () => {
      live = false;
    };
  }, [docId, loadAttempt]);
  const sourceText = docId ? content?.text : documentText;
  const verbatim = content?.layout === 'verbatim';
  // Paragraphs exactly as the marks' anchors count them (`splitParagraphs`, shared with the store).
  const paragraphs = useMemo(() => splitParagraphs(sourceText ?? '', content?.layout), [sourceText, content?.layout]);
  const stylesByPara = useMemo(() => {
    const map = new Map<number, TextStyle[]>();
    for (const st of content?.textStyles ?? []) (map.get(st.anchor.paragraphIndex) ?? map.set(st.anchor.paragraphIndex, []).get(st.anchor.paragraphIndex)!).push(st);
    return map;
  }, [content?.textStyles]);

  // ── Poetry view: per document, kept with the settings ──
  const poetry: PoetryPrefs = (docId && settings.poetry?.[docId]) || DEFAULT_POETRY;
  const [poetryOpen, setPoetryOpen] = useState(false);
  const setPoetry = (next: PoetryPrefs) => {
    if (!docId) return;
    onUpdateSettings?.((prev) => ({ ...prev, poetry: { ...prev.poetry, [docId]: next } }));
  };
  const poem = useMemo(() => (poetry.on ? analysePoem(paragraphs) : null), [poetry.on, paragraphs]);
  const missingProsody = PROSODY_THEMES.filter((p) => !settings.activeThemes.some((t) => t.name.toLowerCase() === p.name.toLowerCase()));
  const addProsodyThemes = () => {
    for (const p of missingProsody) themeStore?.create(p.name, p.color);
  };

  // How far through the text the reader has got: the last paragraph in view, of all of them.
  const reportProgress = useReadingProgress(docId);

  const displayTitle = documentTitle || (documentText ? 'Uploaded Document' : 'No Document Selected');
  // Documents carry no author field, so exports leave the author out rather than invent one.
  const displayAuthor = '';
  const [activeParagraphIndex, setActiveParagraphIndex] = useState<number | null>(null);
  const [showInlineNotes, setShowInlineNotes] = useState(true);
  /** The note opened from a margin pin (narrow margin only). */
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  // On a phone the panel covers the page, so one left open while the window narrows is closed.
  useEffect(() => {
    const phone = window.matchMedia('(max-width: 767.98px)');
    const onChange = () => phone.matches && setIsPanelOpen(false);
    phone.addEventListener('change', onChange);
    return () => phone.removeEventListener('change', onChange);
  }, []);
  const [selectedThemeFilter, setSelectedThemeFilter] = useState<string>('All');
  const [activeControlTab, setActiveControlTab] = useState<Tab>('notes');
  const [slideDirection, setSlideDirection] = useState<number>(1);
  const [activeFocus, setActiveFocus] = useState<AnnotationFocus | null>(focus ?? null);

  const handleSwitchTab = (newTab: Tab) => {
    if (newTab === activeControlTab) return;
    setSlideDirection(TAB_INDEXES[newTab] > TAB_INDEXES[activeControlTab] ? 1 : -1);
    setActiveControlTab(newTab);
  };

  /**
   * The theme new marks are filed under, and so their colour — the same "pick a colour by picking
   * a theme" mechanic as the PDF workspace's theme strip.
   */
  const [activeThemeId, setActiveThemeId] = useState<string | null>(settings.activeThemes[0]?.id ?? null);
  const themeColor = useCallback(
    (themeId: string | null): string => settings.activeThemes.find((t) => t.id === themeId)?.color || FALLBACK_COLOR,
    [settings.activeThemes]
  );
  const activeColor = themeColor(activeThemeId);
  const toolColors = useMemo(
    () =>
      Object.fromEntries(
        ['highlight', 'underline', 'strikeout', 'question', 'star', 'exclamation', 'note'].map((k) => [k, activeColor])
      ),
    [activeColor]
  );

  const [tool, setTool] = useState<TextTool>('select');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * A note being written that does not exist yet. It is only made on Save, so cancelling (Escape,
   * Cancel) leaves nothing behind: no empty note, and no add-then-delete pair in the undo history.
   */
  const [newNote, setNewNote] = useState<{
    ranges: ParagraphRange[];
    quote: string;
    themeId: string | null;
    color: string;
    paragraphOnly?: true;
  } | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftQuote, setDraftQuote] = useState('');

  // Scrolls the "Tagging as" strip so the newly active theme is visible whenever it changes —
  // picking one from the popover or a number key should still bring it into view here.
  const themeStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeThemeId) return;
    const el = themeStripRef.current?.querySelector<HTMLElement>(`[data-theme-id="${activeThemeId}"]`);
    el?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeThemeId, reduceMotion]);

  const textRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const controlBarRef = useRef<HTMLDivElement>(null);
  const [pendingSelection, setPendingSelection] = useState<ParagraphRange[] | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);

  const heads = useMemo(() => groupHeads(marks), [marks]);
  const views = useMemo(
    () => textMarkViews(marks, paragraphs, settings.terminologyColor),
    [marks, paragraphs, settings.terminologyColor]
  );
  const viewById = useMemo(() => new Map(views.map((v) => [v.id, v])), [views]);
  const markById = useMemo(() => new Map(marks.map((m) => [m.id, m])), [marks]);
  const noteHeads = useMemo(() => heads.filter((m) => m.kind === 'note'), [heads]);

  /**
   * Everything a paragraph draws, grouped by paragraph in one pass (not a filter per paragraph),
   * and kept as last render's arrays wherever nothing changed so memoised paragraphs skip.
   */
  const paraCache = useRef<{ marks: Map<number, TextMark[]>; notes: Map<number, NoteItem[]> }>({
    marks: new Map(),
    notes: new Map()
  });
  const paraData = useMemo(() => {
    const byPara = new Map<number, TextMark[]>();
    const glyphs = new Map<number, string[]>();
    const notesBy = new Map<number, NoteItem[]>();
    const headIds = new Set(heads.map((m) => m.id));
    for (const m of marks) {
      const p = m.anchor.paragraphIndex;
      (byPara.get(p) ?? byPara.set(p, []).get(p)!).push(m);
      if (isReactionKind(m.kind) && headIds.has(m.id)) (glyphs.get(p) ?? glyphs.set(p, []).get(p)!).push(m.id);
    }
    for (const n of noteHeads) {
      const p = n.anchor.paragraphIndex;
      (notesBy.get(p) ?? notesBy.set(p, []).get(p)!).push({ mark: n, quote: viewById.get(n.id)?.quote });
    }
    const prev = paraCache.current;
    const next = {
      marks: reuseUnchanged(prev.marks, byPara),
      notes: reuseUnchanged(prev.notes, notesBy, (a, b) => a.mark === b.mark && a.quote === b.quote)
    };
    paraCache.current = next;
    return { ...next, glyphs: new Map([...glyphs].map(([p, ids]) => [p, ids.join(' ')])) };
  }, [marks, heads, noteHeads, viewById]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hoveredSet = useMemo(() => (hoveredId ? expandToGroups(marks, [hoveredId]) : new Set<string>()), [marks, hoveredId]);
  /** Selected and hovered ids per paragraph, so only the paragraphs they touch see a new prop. */
  const idsByPara = useCallback(
    (ids: Set<string>) => {
      const map = new Map<number, string[]>();
      for (const id of ids) {
        const p = markById.get(id)?.anchor.paragraphIndex;
        if (p !== undefined) (map.get(p) ?? map.set(p, []).get(p)!).push(id);
      }
      return new Map([...map].map(([p, list]) => [p, list.sort().join(' ')]));
    },
    [markById]
  );
  const selByPara = useMemo(() => idsByPara(selectedSet), [idsByPara, selectedSet]);
  const hovByPara = useMemo(() => idsByPara(hoveredSet), [idsByPara, hoveredSet]);
  const selectedView = selectedIds.map((id) => viewById.get(id)).find(Boolean);
  const editing = editingId ? markById.get(editingId) : undefined;
  const editorOpen = Boolean(editing || newNote);
  const editorIsNote = Boolean(newNote) || editing?.kind === 'note';
  const editorColor = newNote ? newNote.color : editing ? (editing.isTerminology ? settings.terminologyColor : markColor(editing.color, FALLBACK_COLOR)) : FALLBACK_COLOR;
  const editorPara = newNote ? newNote.ranges[0].paraIdx : (editing?.anchor.paragraphIndex ?? 0);
  const colorOf = (m: TextMark) => (m.isTerminology ? settings.terminologyColor : markColor(m.color, FALLBACK_COLOR));

  // Relative note times ("5 minutes ago") move on once a minute.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const dropSelection = useCallback(() => {
    setPendingSelection(null);
    setSelectionAnchor(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  /**
   * Marks the selection, skipping any part that already carries the same mark. Never toggles —
   * a mark is removed deliberately, from its properties strip — and the new mark becomes the
   * selected one, so its colour or style can be changed straight away.
   */
  const applyMark = useCallback(
    (next: Exclude<TextTool, 'select'>, ranges: ParagraphRange[]) => {
      const isTerminology = next === 'terminology';
      const kind: TextMarkKind = isTerminology ? 'highlight' : next;
      const fresh = uncoveredRanges(marks, ranges, kind, isTerminology, activeThemeId);
      if (fresh.length === 0) return;
      const made = addMarks(
        fresh,
        {
          kind,
          themeId: activeThemeId,
          color: isTerminology ? settings.terminologyColor : activeColor,
          isTerminology: isTerminology || undefined,
          author: settings.name
        },
        paragraphs
      );
      if (made[0]) select([made[0].id]);
    },
    [marks, addMarks, activeThemeId, settings.terminologyColor, settings.name, activeColor, paragraphs, select]
  );

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setNewNote(null);
    setDraftText('');
    setDraftTitle('');
    setDraftQuote('');
  }, []);

  /** Escape discards; Tab stays inside; focus goes back to the opener, else the paragraph's Note button. */
  const editorRef = useRef<HTMLDivElement>(null);
  const editorParaRef = useRef(0);
  // Kept from while the editor is open: on close, `editorPara` already reads 0.
  if (editorOpen) editorParaRef.current = editorPara;
  useDialogFocus(editorRef, editorOpen, closeEditor, () =>
    document.querySelector<HTMLElement>(`#reader-para-${editorParaRef.current} [data-para-note]`) ?? textRef.current
  );

  const startEditing = useCallback(
    (id: string) => {
      const mark = markById.get(id);
      setNewNote(null);
      setEditingId(id);
      setDraftText(mark?.text ?? '');
      setDraftTitle(mark?.title ?? '');
      // The words the note cites: the selected passage it was made on, if any (all ranges joined).
      setDraftQuote(viewById.get(id)?.quote ?? '');
    },
    [markById, viewById]
  );

  /** Save: a new note is made only now, and only with words in it. */
  const saveEditing = useCallback(() => {
    const text = draftText.trim();
    const title = draftTitle.trim();
    if (newNote) {
      if (text || title) {
        const quote = draftQuote.trim();
        addMarks(
          newNote.ranges,
          {
            kind: 'note',
            themeId: newNote.themeId,
            color: newNote.color,
            text,
            title: title || undefined,
            author: settings.name,
            paragraphOnly: newNote.paragraphOnly,
            // Only an edited excerpt is stored, so an untouched one keeps each range's own words.
            ...(quote !== newNote.quote.trim() ? { quote } : {})
          },
          paragraphs
        );
      }
      closeEditor();
      return;
    }
    if (!editingId) return;
    const mark = markById.get(editingId);
    // Emptying an existing note (title and body) and saving it is how a note is cleared away.
    if (mark?.kind === 'note' && !text && !title) deleteMarks([editingId]);
    else if (mark && mark.kind === 'note') {
      const quote = draftQuote.trim();
      const shown = viewById.get(editingId)?.quote ?? '';
      // Only a changed quote is written, so an untouched note keeps each range's own words.
      updateMarks([editingId], { text, title: title || undefined, ...(quote !== shown.trim() ? { quote } : {}) });
    } else if (mark) updateMarks([editingId], { text });
    closeEditor();
  }, [newNote, editingId, markById, viewById, draftText, draftTitle, draftQuote, addMarks, deleteMarks, updateMarks, settings.name, paragraphs, closeEditor]);

  const deleteMark = useCallback(
    (id: string) => {
      deleteMarks([id]);
      if (editingId && expandToGroups(marks, [id]).has(editingId)) setEditingId(null);
    },
    [deleteMarks, editingId, marks]
  );

  /** A sticky note about the selected passage; the editor opens on a draft, made on Save. */
  const createNoteForSelection = useCallback(() => {
    if (!pendingSelection?.length) return;
    const ranges = pendingSelection;
    // Joined the way `textMarkViews` joins a group's ranges, so saving untouched writes no quote.
    const quote = ranges.map((r) => (paragraphs[r.paraIdx] ?? '').slice(r.start, r.end)).filter(Boolean).join(' ');
    dropSelection();
    setEditingId(null);
    setNewNote({ ranges, quote, themeId: activeThemeId, color: activeColor });
    setDraftText('');
    setDraftTitle('');
    setDraftQuote(quote);
  }, [pendingSelection, paragraphs, activeThemeId, activeColor, dropSelection]);

  /** A note on a whole paragraph, with no passage picked (the paragraph's "Note" button). */
  const createParagraphNote = useCallback(
    (paraIdx: number) => {
      setEditingId(null);
      setNewNote({ ranges: [{ paraIdx, start: 0, end: 0 }], quote: '', themeId: activeThemeId, color: activeColor, paragraphOnly: true });
      setDraftText('');
      setDraftTitle('');
      setDraftQuote('');
    },
    [activeThemeId, activeColor]
  );

  /** A ?, * or ! stamped before the selected passage. */
  const createReactionForSelection = useCallback(
    (kind: TextMarkKind) => {
      if (!pendingSelection?.length) return;
      const [made] = addMarks(
        pendingSelection,
        { kind, themeId: activeThemeId, color: activeColor, author: settings.name, fontSize: DEFAULT_TEXT_SIZE },
        paragraphs
      );
      dropSelection();
      if (made) select([made.id]);
    },
    [pendingSelection, addMarks, activeThemeId, activeColor, settings.name, paragraphs, dropSelection, select]
  );

  /**
   * A tool was tapped. With text selected it marks that passage once and puts the tool back
   * down; with nothing selected it arms the tool for the next selection (tap again to disarm).
   */
  const handleToolTap = useCallback(
    (next: TextTool) => {
      if (next !== 'select' && pendingSelection?.length) {
        applyMark(next, pendingSelection);
        setTool('select');
        dropSelection();
        return;
      }
      setTool((current) => (current === next ? 'select' : next));
    },
    [pendingSelection, applyMark, dropSelection]
  );

  /**
   * Reads the live selection, the same rules as the PDF workspace: the menu acts on exactly this
   * passage. A mouse or pen release reads it at once, and an armed tool marks it; after touch
   * (long-press, selection handles: no mouseup, often no pointerup) or keyboard selection it is
   * read once the selection settles, and an armed tool waits for a tap. See `selectionTrigger`.
   */
  useEffect(() => {
    const sync = (applyArmedTool: boolean) => {
      // Typing a new theme's name in the selection menu moves the browser's selection; the passage stays.
      if ((document.activeElement as HTMLElement | null)?.closest('[data-keep-selection]')) return;
      const sel = window.getSelection();
      const state =
        sel && !sel.isCollapsed && textRef.current
          ? selectionState(sel.toString().trim(), rangesFromSelectionParts(selectionParagraphParts(textRef.current, PARA_TEXT_ID_PREFIX)))
          : null;
      if (!state) {
        if (!sel?.toString().trim()) {
          setPendingSelection(null);
          setSelectionAnchor(null);
        }
        return;
      }
      // An armed tool marks the passage at once, so only the new mark's toolbar shows, not the menu too.
      if (applyArmedTool && tool !== 'select') {
        applyMark(tool, state.ranges);
        dropSelection();
        return;
      }
      setPendingSelection(state.ranges);
      const rect = sel!.rangeCount ? sel!.getRangeAt(0).getBoundingClientRect() : null;
      if (rect && rect.width + rect.height > 0) setSelectionAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom });
    };

    let last: InputKind | null = null;
    let timer: number | undefined;
    const run = (event: 'pointerup' | 'selectionchange') => {
      const t = selectionTrigger(last, event);
      if (t.mode === 'ignore') return;
      window.clearTimeout(timer);
      if (t.mode === 'now') {
        const apply = t.applyArmedTool;
        timer = window.setTimeout(() => sync(apply), 0);
        return;
      }
      timer = window.setTimeout(() => {
        const node = window.getSelection()?.anchorNode;
        if (node && !textRef.current?.contains(node)) return;
        sync(false);
      }, t.delayMs);
    };
    const onPointerDown = (e: PointerEvent) => {
      last = inputKindOf(e.pointerType);
    };
    const onPointerUp = (e: PointerEvent) => {
      last = inputKindOf(e.pointerType);
      run('pointerup');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTypingTarget(e.target)) last = 'key';
    };
    const onSelectionChange = () => run('selectionchange');
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [tool, applyMark, dropSelection]);

  /**
   * Keyboard shortcuts, the PDF workspace's (`workspaceKeys.ts`): Escape, undo/redo, Delete,
   * H U S pick a tool (acting on selected text), N writes a note about the selection, V puts the
   * tool down, 1–9 choose a theme (or re-file the selected mark). Never while typing or in a dialog.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editorOpen || e.defaultPrevented || (e.repeat && !/^(z|y)$/i.test(e.key))) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const action = resolveWorkspaceKey(e);
      if (!action) return;
      const hasSelection = Boolean(selectionAnchor && pendingSelection?.length);
      switch (action.type) {
        case 'escape':
          if (escapeConsumes({ tool, markSelected: selectedIds.length > 0, textSelected: hasSelection })) e.preventDefault();
          setTool('select');
          clearSelection();
          setSelectionAnchor(null);
          return;
        case 'undo':
          e.preventDefault();
          undo();
          return;
        case 'redo':
          e.preventDefault();
          redo();
          return;
        case 'delete':
          if (selectedIds.length === 0) return;
          e.preventDefault();
          deleteMarks(selectedIds);
          return;
        case 'tool': {
          const t = action.tool;
          if (t === 'note') {
            if (!hasSelection) return;
            e.preventDefault();
            createNoteForSelection();
            return;
          }
          if (t !== 'select' && t !== 'highlight' && t !== 'underline' && t !== 'strikeout') return;
          e.preventDefault();
          handleToolTap(t);
          return;
        }
        case 'theme': {
          const theme = settings.activeThemes[action.index];
          if (!theme) return;
          e.preventDefault();
          if (!hasSelection && selectedIds.length) updateMarks(selectedIds, { themeId: theme.id, color: theme.color });
          else setActiveThemeId(theme.id);
          return;
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    editorOpen,
    tool,
    selectionAnchor,
    pendingSelection,
    selectedIds,
    clearSelection,
    undo,
    redo,
    deleteMarks,
    updateMarks,
    createNoteForSelection,
    handleToolTap,
    settings.activeThemes
  ]);

  /** The selected mark's on-screen box, kept current while the page scrolls. */
  const [markRect, setMarkRect] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const selectedKey = selectedIds.join(' ');
  useEffect(() => {
    if (!selectedKey) {
      setMarkRect(null);
      return;
    }
    const measure = () => {
      const root = textRef.current;
      if (!root) return setMarkRect(null);
      const ids = selectedKey.split(' ');
      let els = ids.flatMap((id) => Array.from(root.querySelectorAll<HTMLElement>(`[data-mark-ids~="${id}"]`)));
      if (els.length === 0) els = ids.flatMap((id) => Array.from(root.querySelectorAll<HTMLElement>(`[data-note-card="${id}"]`)));
      const rects = els.flatMap((el) => Array.from(el.getClientRects()));
      if (rects.length === 0) return setMarkRect(null);
      const next = {
        left: Math.min(...rects.map((r) => r.left)),
        top: Math.min(...rects.map((r) => r.top)),
        right: Math.max(...rects.map((r) => r.right)),
        bottom: Math.max(...rects.map((r) => r.bottom))
      };
      // An unchanged box is not a new state: no re-render of the strip for a scroll that moved nothing.
      setMarkRect((prev) =>
        prev && prev.left === next.left && prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom ? prev : next
      );
    };
    measure();
    // Once per frame at most, however many scroll events a frame brings.
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [selectedKey, marks, showInlineNotes, isPanelOpen]);

  // The selection menu follows its passage when the page scrolls under it.
  useEffect(() => {
    if (!selectionAnchor) return;
    let frame = 0;
    const follow = () => {
      frame = 0;
      const sel = window.getSelection();
      const rect = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if (!rect || rect.width + rect.height <= 0) return;
      setSelectionAnchor((prev) =>
        prev && prev.left === rect.left && prev.top === rect.top && prev.bottom === rect.bottom
          ? prev
          : { left: rect.left, top: rect.top, bottom: rect.bottom }
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(follow);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, true);
    };
    // Re-subscribed only when a menu opens or closes, not on every move it makes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(selectionAnchor)]);

  /** Brings a mark into view. False while its text is not on screen yet, so the navigator retries. */
  const scrollToMark = useCallback(
    (id: string): boolean => {
      if (activeControlTab !== 'notes') {
        handleSwitchTab('notes');
        return false;
      }
      const root = textRef.current;
      const el =
        root?.querySelector<HTMLElement>(`[data-mark-ids~="${id}"]`) ??
        root?.querySelector<HTMLElement>(`[data-note-card="${id}"]`) ??
        null;
      if (!el) return false;
      if (spreadHandle.current) {
        spreadHandle.current.showElement(el);
        return true;
      }
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeControlTab, reduceMotion]
  );
  // The latest one, for retries started from a tab that is about to unmount (the excerpt board).
  const scrollToMarkRef = useRef(scrollToMark);
  scrollToMarkRef.current = scrollToMark;

  /**
   * What a paragraph can do, as one object that never changes: each call reads the latest
   * handlers from a ref, so a memoised paragraph is not re-rendered just because a handler was.
   */
  const handlersRef = useRef({ startEditing, deleteMark, createParagraphNote, select });
  handlersRef.current = { startEditing, deleteMark, createParagraphNote, select };
  const paragraphActions = useMemo<ParagraphActions>(
    () => ({
      // Clicking marked words selects the topmost visible mark there (not while selecting text).
      markClick: (e, id) => {
        if (window.getSelection()?.toString().trim()) return;
        e.stopPropagation();
        handlersRef.current.select([id]);
      },
      hover: (id) => setHoveredId(id),
      edit: (id) => handlersRef.current.startEditing(id),
      remove: (id) => handlersRef.current.deleteMark(id),
      togglePin: (id) => setOpenPin(id),
      addNote: (idx) => handlersRef.current.createParagraphNote(idx),
      activate: (idx) => setActiveParagraphIndex(idx)
    }),
    []
  );
  // Reports the last paragraph in view as the reader scrolls (debounced by the hook), and once
  // on opening, so a document read in one screen still counts as read that far.
  useEffect(() => {
    if (!docId || paragraphs.length === 0 || activeControlTab !== 'notes') return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // In the spread, pages after the open pair sit to the right of its window.
      const spreadRight = document.querySelector('.spread-window')?.getBoundingClientRect().right ?? Infinity;
      // Binary search: paragraphs run top to bottom, so find the last one whose top is on screen.
      let lo = 0;
      let hi = paragraphs.length - 1;
      let last = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const el = document.getElementById(`reader-para-${mid}`);
        if (!el) return;
        const box = el.getBoundingClientRect();
        if (box.top < window.innerHeight && box.left < spreadRight) {
          last = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (last >= 0) reportProgress(last + 1, paragraphs.length);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const first = window.setTimeout(measure, 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(first);
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [docId, paragraphs.length, activeControlTab, reportProgress]);

  /**
   * The margin: note cards beside the text when there is room for both, else pins in a narrow
   * gutter. Room is the body's width less the docked marks panel (an overlay on a phone).
   */
  const bodyRef = useRef<HTMLDivElement>(null);
  // A state, not a ref: the column remounts with the reading tab, and the layout must follow it.
  const [flow, setFlow] = useState<HTMLDivElement | null>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBodyWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const docked = isPanelOpen && typeof window !== 'undefined' && window.innerWidth >= 768 ? 320 : 0;
  /**
   * Two-page spread: the reader's choice, shown only on the reading tab and only while the body
   * has room for two readable pages; narrower, the same text falls back to one scrolling page.
   */
  const spreadPref = settings.readerSpread === true;
  const spreadFits = bodyWidth - docked >= MIN_SPREAD_WIDTH;
  const spreadOn = spreadPref && spreadFits && activeControlTab === 'notes';
  const spreadHandle = useRef<TextSpreadHandle>(null);
  /** Where to open (entering) or return to (leaving) the spread: a paragraph's element id. */
  const spreadStartId = useRef<string | null>(null);
  const toggleSpread = () => {
    if (!spreadPref) {
      // The first paragraph still on screen below the bars is the page the book opens at.
      const top = controlBarRef.current?.getBoundingClientRect().bottom ?? 0;
      const first = Array.from(document.querySelectorAll<HTMLElement>('[id^="reader-para-"]:not([id^="reader-para-text-"])')).find(
        (el) => el.getBoundingClientRect().bottom > top + 8
      );
      spreadStartId.current = first?.id ?? null;
    }
    onSpreadChange?.(!spreadPref);
  };
  // Back in the scrolling view: land on the paragraph the spread was showing.
  const wasSpread = useRef(false);
  useLayoutEffect(() => {
    if (wasSpread.current && !spreadOn) {
      const el = spreadStartId.current ? document.getElementById(spreadStartId.current) : null;
      const top = controlBarRef.current?.getBoundingClientRect().bottom ?? 0;
      window.scrollTo({ top: el ? el.getBoundingClientRect().top + window.scrollY - top - 16 : 0 });
    }
    if (spreadOn) window.scrollTo({ top: 0 });
    wasSpread.current = spreadOn;
  }, [spreadOn]);
  // 40: the text column's own side padding.
  const marginMode: MarginMode = !showInlineNotes || spreadOn
    ? 'off'
    : bodyWidth - docked >= MIN_TEXT_PX + MARGIN_CARDS_PX + 40
      ? 'cards'
      : 'pins';
  useEffect(() => {
    if (marginMode !== 'pins') setOpenPin(null);
  }, [marginMode]);
  // An open pin closes on Escape or a press anywhere but itself.
  useEffect(() => {
    if (!openPin) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(`[data-margin-item="${openPin}"]`)) setOpenPin(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpenPin(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [openPin]);

  /**
   * Puts each margin note level with the first line of its words (a paragraph note: the
   * paragraph's first line), pushed down only as far as it takes to clear the note above.
   * Offsets, not client rects, so the tab's slide-in transform does not skew the maths.
   */
  const layoutMargin = useCallback(() => {
    if (!flow) return;
    const nodes = Array.from(flow.querySelectorAll<HTMLElement>('[data-margin-item]'));
    const items = nodes.map((node) => {
      const id = node.dataset.marginItem!;
      const para = node.parentElement!;
      const word = para.querySelector<HTMLElement>(`p [data-mark-ids~="${id}"]`);
      // 10: the paragraph's own top padding, where its first line starts.
      const lineTop = word ? word.offsetTop : 10;
      // Middle of that first line, where a connector would leave it.
      const lineMid = word ? Math.round(word.offsetHeight / 2) : 14;
      return { id, node, paraTop: para.offsetTop, desired: para.offsetTop + lineTop, lineMid, height: node.offsetHeight };
    });
    const { tops, bottom } = stackMargin(items, marginMode === 'pins' ? 4 : 10);
    for (const it of items) {
      const top = tops.get(it.id) ?? it.desired;
      it.node.style.top = `${top - it.paraTop}px`;
      // A card pushed down off its line gets a thin rule back to it: out of the line, down the
      // gutter, into the card at the height it would have met it (so the drop reads as exact).
      const link = it.node.querySelector<SVGSVGElement>('[data-margin-link]');
      const shift = Math.round(top - it.desired);
      if (!link) continue;
      link.style.display = shift > 3 ? 'block' : 'none';
      if (shift <= 3) continue;
      link.style.top = `${it.lineMid - shift}px`;
      link.style.height = `${shift}px`;
      link.querySelector('path')?.setAttribute('d', `M2 0.5 H12 V${shift + 0.5} H24`);
    }
    // Room below the last paragraph for a stack of notes that runs past the end of the text.
    const content = flow.scrollHeight - (parseFloat(flow.style.paddingBottom) || 0);
    flow.style.paddingBottom = `${Math.max(0, Math.ceil(bottom - content))}px`;
  }, [flow, marginMode]);
  useLayoutEffect(() => {
    layoutMargin();
    if (!flow) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layoutMargin);
    });
    observer.observe(flow);
    // Cards change height without the column doing so (a note edited, a webfont arriving).
    flow.querySelectorAll('[data-margin-item]').forEach((n) => observer.observe(n));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [flow, layoutMargin, paraData, openPin, settings.fontSize, settings.typography]);

  /**
   * What the selection menu and the properties strip must keep clear: every glyph box of the
   * paragraphs on screen, plus their "+ Note" rows. In card mode the margin beside the text is
   * free (bar note cards, which the panels avoid), so that is where they go, level with the line.
   * On a phone the bottom nav's strip is chrome already over the page: a panel may sit there,
   * spanning it like a sheet.
   */
  const placementContext = useCallback((): PanelContext => {
    const obstacles: PanelContext['obstacles'] = [];
    const range = document.createRange();
    flow?.querySelectorAll<HTMLElement>(`[id^="${PARA_TEXT_ID_PREFIX}"], [data-para-note]`).forEach((el) => {
      const box = el.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;
      range.selectNodeContents(el);
      for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) obstacles.push(r);
    });
    const column = flow?.getBoundingClientRect();
    // 24: the gap the note cards keep from the text (`ml-6`); 16: from the window edge.
    const lane = marginMode === 'cards' && column ? { left: column.right + 24, right: window.innerWidth - 16 } : undefined;
    // The nav's resting place, even while it is slid away on scroll: the panel takes its spot.
    const navHeight = document.getElementById('bottom-navigation-bar')?.offsetHeight ?? 0;
    const dock = navHeight
      ? { left: 0, right: window.innerWidth, top: window.innerHeight - navHeight, bottom: window.innerHeight }
      : undefined;
    return { obstacles, lane, dock };
  }, [flow, marginMode]);

  // Line or sher numbers in the gutter, radif and rhyme underlined (poetry view only).
  const poemTextId = useCallback((i: number) => `${PARA_TEXT_ID_PREFIX}${i}`, []);
  usePoemOverlay({
    analysis: activeControlTab === 'notes' ? poem : null,
    prefs: poetry,
    flow,
    textId: poemTextId,
    layoutKey: `${settings.fontSize}|${settings.typography}|${settings.arabicScript}|${spreadOn}|${marginMode}|${marks.length}`
  });

  const paragraphFont = settings.typography.includes('Newsreader')
    ? 'Newsreader, Georgia, serif'
    : settings.typography.includes('Sans')
      ? 'Plus Jakarta Sans, sans-serif'
      : 'Literata, Georgia, serif';

  // What the export tab writes: every mark (highlights included), one entry per mark.
  const exportEntries = useMemo(() => textMarksForExport(marks, paragraphs), [marks, paragraphs]);
  const exportable = getFilteredAnnotations(exportEntries, selectedThemeFilter);
  const runExport = (format: ExportOptions['format']) => {
    const opts: ExportOptions = {
      bookTitle: displayTitle,
      bookAuthor: displayAuthor,
      themeFilter: selectedThemeFilter,
      themes: settings.activeThemes,
      format,
      includeQuotes: true
    };
    if (format === 'pdf') {
      // jsPDF has no right-to-left glyphs or Nastaliq shaping; such notes print through the desktop app's renderer.
      if (hasRtlText([displayTitle, ...exportable.flatMap((e) => [e.quote, e.content, e.title])])) {
        void (async () => {
          const font = await fetch(nastaliqFontUrl)
            .then((r) => r.blob())
            .then((b) => new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b); }))
            .catch(() => undefined);
          const pdf = await printNotesPdf(notesPrintHtml(exportable, opts, font?.replace(/^data:[^;]*;/, 'data:font/woff2;'), settings.arabicScript));
          if (!pdf) return exportToPDF(exportable, opts);
          const url = URL.createObjectURL(pdf);
          const a = document.createElement('a');
          a.href = url;
          a.download = `marginalia-annotations-${displayTitle.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document'}.pdf`;
          a.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        })();
      } else exportToPDF(exportable, opts);
    }
    else if (format === 'markdown') downloadTextFile(generateMarkdown(exportable, opts), `${displayTitle}-annotations.md`, 'text/markdown');
    else downloadTextFile(generatePlainText(exportable, opts), `${displayTitle}-annotations.txt`, 'text/plain');
  };

  // ── Find in document (Cmd+F) ──
  const paraEl = (i: number) => document.getElementById(`${PARA_TEXT_ID_PREFIX}${i}`);
  const find = useDocumentFind({
    enabled: activeControlTab === 'notes' && !editorOpen && paragraphs.length > 0,
    units: paragraphs,
    unitElement: paraEl,
    root: () => textRef.current,
    startUnit: () => {
      // The first paragraph whose foot is below the control bar (binary search: they run down the page).
      const top = controlBarRef.current?.getBoundingClientRect().bottom ?? 0;
      let lo = 0;
      let hi = paragraphs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const r = paraEl(mid)?.getBoundingClientRect();
        if (r && r.bottom < top) lo = mid + 1;
        else hi = mid;
      }
      return spreadOn ? 0 : lo;
    },
    reveal: (i, range) => {
      const el = paraEl(i);
      if (!el) return;
      if (spreadHandle.current) return spreadHandle.current.showElement(range ?? el);
      const box = (range ?? el).getBoundingClientRect();
      const top = (controlBarRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
      const bottom = window.innerHeight - bottomInset - 48;
      if (box.top >= top && box.bottom <= bottom) return;
      window.scrollBy({ top: box.top - (top + bottom) / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  });

  // ── Copy quote and linked marks ──
  const cite = (quote: string, anchor: { paragraphIndex: number; start: number; end: number }) =>
    formatQuoteRef(quote, displayTitle, markLocation({ id: '', anchor }, { paragraphs, layout: content?.layout }));
  const copyQuoteOf = (id: string, quote: string) => {
    const m = markById.get(id);
    return copyText(m ? cite(quote, m.anchor) : formatQuoteRef(quote, displayTitle, null));
  };
  const copySelectionQuote = (ranges: ParagraphRange[]) => {
    const quote = ranges.map((r) => (paragraphs[r.paraIdx] ?? '').slice(r.start, r.end)).join('\n');
    const first = ranges[0];
    return copyText(cite(quote, { paragraphIndex: first.paraIdx, start: first.start, end: first.end }));
  };
  const linkOption = (v: (typeof views)[number]) => ({
    id: v.id,
    label: excerpt(v.quote || v.text || 'Mark'),
    where: `para. ${v.page}`
  });
  const markLinksFor = (id: string): MarkLinks => {
    const linked = new Set(linkedIds(marks, id));
    return {
      linked: views.filter((v) => linked.has(v.id)).map(linkOption),
      candidates: views.filter((v) => v.id !== id).map(linkOption),
      onLink: (other) => annotations.commit((prev) => linkMarks(prev, id, other)),
      onUnlink: (other) => annotations.commit((prev) => unlinkMarks(prev, id, other)),
      onJump: (other) => {
        select([other]);
        scrollToMark(other);
      }
    };
  };

  // Every mark, for keeping: full Markdown/JSON, the commonplace book, import and restore.
  const archive = useMarksArchive({
    docId,
    doc: { id: docId, title: displayTitle, layout: content?.layout, paragraphs },
    entries: annotations.entries,
    themes: settings.activeThemes,
    saver: annotations.saver,
    reset: annotations.reset,
    onAddThemes: (t) => onAddThemes?.(t),
    isDark,
    teacher: settings.name
  });

  // ── Excerpt board ──
  const boardItems = useMemo(
    () =>
      heads
        .filter((m) => !isReactionKind(m.kind))
        .map((m) => ({ mark: m, quote: viewById.get(m.id)?.quote ?? '', color: colorOf(m) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heads, viewById, settings.terminologyColor]
  );

  // ── Arriving from a motif trace: show the passage and paint the traced words ──
  const [activeJump, setActiveJump] = useState<ReaderJump | null>(jump ?? null);
  const jumpDone = useRef(false);
  useEffect(() => {
    if (!activeJump || paragraphs.length === 0 || activeControlTab !== 'notes') {
      paintHighlight('motif-hit', []);
      return;
    }
    const paint = () => {
      const ranges: Range[] = [];
      paragraphs.forEach((text, i) => {
        const hits = paragraphHits(text, activeJump.terms ?? []);
        if (!hits.length) return;
        const el = document.getElementById(`${PARA_TEXT_ID_PREFIX}${i}`);
        if (!el) return;
        const pieces = readPieces(el);
        for (const h of hits) {
          const r = rangeFor(pieces, h.start, h.end);
          if (r) ranges.push(r);
        }
      });
      paintHighlight('motif-hit', ranges);
    };
    const t = window.setTimeout(() => {
      paint();
      if (jumpDone.current) return;
      jumpDone.current = true;
      const el = document.getElementById(`reader-para-${activeJump.paragraphIndex}`);
      if (!el) return;
      if (spreadHandle.current) spreadHandle.current.showElement(el);
      else el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      setActiveParagraphIndex(activeJump.paragraphIndex);
    }, 350);
    return () => {
      window.clearTimeout(t);
      paintHighlight('motif-hit', []);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJump, paragraphs, activeControlTab, marks, spreadOn]);

  // Popovers stay below the sticky header and control bar.
  // In focus mode the bar slides over the page when called, so menus keep clear of where it lands.
  const popoverTopInset = focusMode
    ? (controlBarRef.current?.offsetHeight ?? 0)
    : (controlBarRef.current?.getBoundingClientRect().bottom ?? headerRef.current?.getBoundingClientRect().bottom ?? 0);
  const bottomInset = activeFocus ? NAVIGATOR_HEIGHT : 0;
  // A passage scrolled wholly out from under the control bar takes its menu with it (it comes
  // back on scrolling back); a menu pinned to the edge would act on words the reader can't see.
  const selectionInView =
    !!selectionAnchor && selectionAnchor.bottom > popoverTopInset && selectionAnchor.top < window.innerHeight - bottomInset;
  const pillClass = (active: boolean) =>
    `flex items-center gap-1.5 transition-all duration-200 cursor-pointer shrink-0 ${
      active
        ? 'bg-accent text-on-accent px-3 py-1.5 rounded-xl font-semibold shadow-xs animate-in fade-in zoom-in-95'
        : 'p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 text-stone-700 dark:text-stone-300'
    }`;
  const iconBtn =
    'p-2 rounded-lg text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-stone-800 dark:hover:text-stone-200 disabled:opacity-30 cursor-pointer disabled:cursor-default shrink-0';

  const titleBlock = (
    <div
      id="reader-title-block"
      className={`text-center flex flex-col items-center justify-center space-y-2 ${
        paragraphs.length === 0 ? 'min-h-[60vh]' : 'border-b pb-6 border-stone-200 dark:border-stone-800'
      }`}
    >
      <div className="flex items-center justify-center gap-2 flex-wrap text-[11px]">
        <span className="caps text-gold">DOCUMENT</span>
        <span className="text-stone-300 dark:text-stone-700">•</span>
        <span className="text-muted italic">Select text to mark it, or write a note</span>
      </div>
      <h2 className="title-hand text-balance text-[36px] sm:text-[44px] text-stone-900 dark:text-paper">
        {displayTitle}
      </h2>
      {loadFailed && !content && (
        <div role="alert" className="pt-4 flex flex-col items-center gap-3">
          <p className="text-[14px] text-muted">This document could not be loaded, so it can’t be marked yet.</p>
          <button
            type="button"
            onClick={() => setLoadAttempt((n) => n + 1)}
            className="rounded-full caps px-5 py-2.5 text-[12px] bg-accent hover:bg-accent-hover text-on-accent transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
  const paragraphNodes = paragraphs.map((text, idx) => {
    const notes = paraData.notes.get(idx) ?? EMPTY_NOTES;
    const face = paragraphTypeface(text, paragraphFont, settings.arabicScript);
    return (
      <Paragraph
        key={idx}
        idx={idx}
        text={text}
        marks={paraData.marks.get(idx) ?? EMPTY_MARKS}
        glyphHeads={paraData.glyphs.get(idx) ?? ''}
        notes={notes}
        selKey={selByPara.get(idx) ?? ''}
        hovKey={hovByPara.get(idx) ?? ''}
        isActive={activeParagraphIndex === idx}
        isDark={isDark}
        margin={marginMode}
        verbatim={verbatim || poetry.on}
        styles={stylesByPara.get(idx) ?? EMPTY_STYLES}
        openPin={openPin && notes.some((n) => n.mark.id === openPin) ? openPin : ''}
        terminologyColor={settings.terminologyColor}
        fontFamily={face.fontFamily}
        dir={face.dir}
        lineHeight={face.lineHeight}
        fontSize={settings.fontSize}
        clock={notes.length ? clock : 0}
        actions={paragraphActions}
      />
    );
  });

  return (
    <div className={`min-h-screen flex flex-col transition-colors ${isDark ? 'bg-night text-stone-100' : 'bg-paper text-ink'}`}>
      {/* Theme picker — which theme new marks are filed under, and so their colour. */}
      <div
        hidden={focusMode}
        className={`pl-3 sm:pl-6 py-2 border-b flex items-center gap-1.5 text-[11px] w-full max-w-full ${
          isDark ? 'bg-night-2 border-stone-800/80' : 'bg-stone-100 border-stone-200'
        }`}
      >
        {/* The label stays put; only the chips scroll, so it is never clipped at 320 px. */}
        <span className="font-semibold text-muted shrink-0">Tagging as</span>
        <div
          ref={themeStripRef}
          className="chip-strip min-w-0 flex-1 flex items-center gap-1.5 pr-3 sm:pr-6 overflow-x-auto snap-x snap-mandatory scroll-smooth"
        >
        {settings.activeThemes.map((theme, i) => (
          <button
            key={theme.id}
            data-theme-id={theme.id}
            type="button"
            onClick={() => setActiveThemeId(theme.id)}
            aria-pressed={activeThemeId === theme.id}
            aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
            className={`px-2 py-0.5 rounded-lg font-medium transition-all flex items-center gap-1.5 cursor-pointer shrink-0 snap-start ${
              activeThemeId === theme.id
                ? 'bg-stone-900 dark:bg-white text-white dark:text-stone-900 shadow-xs'
                : 'text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: theme.color }} />
            <span className="whitespace-nowrap">{theme.name}</span>
          </button>
        ))}
        </div>
      </div>

      {/* Top Reader Navigation Bar */}
      <header
        ref={headerRef}
        hidden={focusMode}
        className={`app-drag sticky top-0 z-40 px-3 sm:px-6 h-18 border-b flex items-center justify-between gap-2 backdrop-blur-md transition-colors w-full max-w-full overflow-hidden ${
          isDark ? 'bg-night/90 border-stone-800' : 'bg-paper/90 border-stone-200/80'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 max-w-[65%] sm:max-w-md">
          <button
            id="reader-back-library-btn"
            type="button"
            onClick={() => onNavigate('home', 'push_back')}
            className="p-1.5 rounded-xl text-stone-700 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            title="Back to My Collections"
            aria-label="Back to My Collections"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 truncate">
            <h1 className="title-hand text-[22px] sm:text-[25px] truncate text-stone-900 dark:text-paper">
              {displayTitle}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            id="reader-top-settings-btn"
            type="button"
            onClick={() => onNavigate('settings', 'push')}
            className="p-1.5 sm:p-2 rounded-xl text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            aria-label="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Reader control bar: tabs on the left, the PDF workspace's text tools, undo and the
          notes panel on the right. Sticks under the header, so the tools stay in reach while
          reading down a long document, and wraps to two rows on a phone rather than scrolling
          undo and the notes panel out of sight. */}
      <FocusChrome focus={focusMode} selecting={Boolean(pendingSelection?.length || selectedIds.length)}>
      <div
        ref={controlBarRef}
        className={`sticky top-18 z-30 px-3 sm:px-6 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-[12px] w-full max-w-full ${
          isDark ? 'bg-night-2 border-stone-800/80' : 'bg-stone-100 border-stone-200'
        }`}
      >
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            // Arriving from another tab switches to the text; pressing it again shows or hides
            // the notes written in the margin.
            onClick={() => {
              if (activeControlTab === 'notes') setShowInlineNotes((shown) => !shown);
              else handleSwitchTab('notes');
            }}
            aria-pressed={activeControlTab === 'notes' ? showInlineNotes : undefined}
            className={pillClass(activeControlTab === 'notes')}
            title={activeControlTab === 'notes' ? (showInlineNotes ? 'Hide margin notes' : 'Show margin notes') : 'Back to reading'}
          >
            <StickyNoteIcon className="w-4 h-4" />
            {activeControlTab === 'notes' && (
              <span className="spine-type whitespace-nowrap animate-in fade-in duration-150">
                {/* Counts what it names, like the panel: marks always, notes only when there are some. */}
                {plural(views.length, 'mark')}
                {noteHeads.length > 0 && ` · ${plural(noteHeads.length, 'note')}`}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              handleSwitchTab('notes');
              createParagraphNote(activeParagraphIndex ?? 0);
            }}
            className={pillClass(false)}
            title="Add a note to the current paragraph"
            aria-label="Add a note to the current paragraph"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            id="reader-bar-export-btn"
            type="button"
            onClick={() => handleSwitchTab('export')}
            className={pillClass(activeControlTab === 'export')}
            title="Export Notes"
          >
            <Download className="w-4 h-4" />
            {activeControlTab === 'export' && <span className="whitespace-nowrap animate-in fade-in duration-150">Export Notes</span>}
          </button>
          <button
            type="button"
            onClick={() => handleSwitchTab(activeControlTab === 'board' ? 'notes' : 'board')}
            className={pillClass(activeControlTab === 'board')}
            title="Excerpt board: arrange your marked passages side by side"
            aria-pressed={activeControlTab === 'board'}
          >
            <BoardIcon className="w-4 h-4" />
            {activeControlTab === 'board' && <span className="whitespace-nowrap animate-in fade-in duration-150">Excerpt board</span>}
          </button>
          {docId && (
            <button
              type="button"
              onClick={() => setPoetryOpen((o) => !o)}
              className={pillClass(poetry.on)}
              title="Poetry view: line and sher numbers, radif and rhyme"
              aria-label="Poetry view"
              aria-expanded={poetryOpen}
            >
              <Feather className="w-4 h-4" />
              {poetry.on && <span className="whitespace-nowrap animate-in fade-in duration-150">Poem</span>}
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {TEXT_TOOLS.map(({ id, label, icon: Icon }) => {
            const active = tool === id;
            const color = id === 'terminology' ? settings.terminologyColor : activeColor;
            const hint = pendingSelection?.length ? `${label} the selected text` : `Select text to ${label.toLowerCase()} it`;
            return (
              <HoverTooltip key={id} label={withShortcut(hint, TOOL_HOTKEYS[id as keyof typeof TOOL_HOTKEYS])}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleToolTap(id)}
                  aria-label={withShortcut(label, TOOL_HOTKEYS[id as keyof typeof TOOL_HOTKEYS])}
                  aria-keyshortcuts={TOOL_HOTKEYS[id as keyof typeof TOOL_HOTKEYS]}
                  aria-pressed={active}
                  className={`p-2 rounded-lg cursor-pointer shrink-0 transition-colors ${
                    active
                      ? 'bg-nav-active text-nav-active-fg dark:shadow-[inset_0_0_0_1px_var(--nav-active-ring)]'
                      : 'text-muted hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4" style={{ color: isDark && color.toLowerCase() === '#000000' ? 'var(--color-paper)' : color }} />
                </button>
              </HoverTooltip>
            );
          })}
          <span aria-hidden className={`w-px h-6 mx-1 ${isDark ? 'bg-stone-700' : 'bg-stone-300'}`} />
          <HoverTooltip label={`Undo (${MODIFIER}Z)`}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={undo} disabled={!canUndo} aria-label="Undo" className={iconBtn}>
              <Undo2 className="w-4 h-4" />
            </button>
          </HoverTooltip>
          <HoverTooltip label={`Redo (${SHIFT_MODIFIER}Z)`}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={redo} disabled={!canRedo} aria-label="Redo" className={iconBtn}>
              <Redo2 className="w-4 h-4" />
            </button>
          </HoverTooltip>
          <span aria-hidden className={`w-px h-6 mx-1 ${isDark ? 'bg-stone-700' : 'bg-stone-300'}`} />
          <HoverTooltip label={`Find in document (${FIND_SHORTCUT})`}>
            <button
              type="button"
              onClick={find.open ? find.close : find.openFind}
              aria-label="Find in document"
              aria-keyshortcuts={IS_APPLE ? 'Meta+F' : 'Control+F'}
              aria-pressed={find.open}
              disabled={activeControlTab !== 'notes'}
              className={`${iconBtn} ${find.open ? 'text-gold dark:text-gold' : ''}`}
            >
              <Search className="w-4 h-4" />
            </button>
          </HoverTooltip>
          <HoverTooltip
            label={
              spreadPref && !spreadFits
                ? 'Two-page spread (window too narrow, showing one page)'
                : spreadPref
                  ? 'Single page (scroll)'
                  : 'Two-page spread (← → turn pages)'
            }
          >
            <button
              type="button"
              onClick={toggleSpread}
              aria-label="Two-page spread"
              aria-pressed={spreadPref}
              className={`${iconBtn} max-md:hidden ${spreadPref ? 'text-gold dark:text-gold' : ''}`}
            >
              <BookOpen className="w-4 h-4" weight={spreadOn ? 'fill' : 'regular'} />
            </button>
          </HoverTooltip>
          <HoverTooltip label={isPanelOpen ? 'Hide marks panel' : 'Show marks panel'}>
            <button
              type="button"
              onClick={() => setIsPanelOpen((open) => !open)}
              aria-label={isPanelOpen ? 'Hide marks panel' : 'Show marks panel'}
              aria-pressed={isPanelOpen}
              className={`${iconBtn} ${isPanelOpen ? 'text-gold dark:text-gold' : ''}`}
            >
              <PanelRightOpen className="w-4 h-4" weight={isPanelOpen ? 'fill' : 'regular'} />
            </button>
          </HoverTooltip>
          {onToggleFocus && (
            <HoverTooltip label={focusMode ? `Leave focus mode (${FOCUS_HOTKEY} or Esc)` : `Focus mode (${FOCUS_HOTKEY})`}>
              <button
                type="button"
                onClick={onToggleFocus}
                aria-label={focusMode ? `Leave focus mode (${FOCUS_HOTKEY})` : `Focus mode (${FOCUS_HOTKEY})`}
                aria-keyshortcuts={FOCUS_HOTKEY}
                aria-pressed={focusMode}
                className={`${iconBtn} ${focusMode ? 'text-gold dark:text-gold' : ''}`}
              >
                {focusMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </HoverTooltip>
          )}
        </div>
        <FindBar find={find} isDark={isDark} className="basis-full w-full" />
        <PoetryPanel
          open={poetryOpen}
          prefs={poetry}
          analysis={poem}
          isDark={isDark}
          onChange={setPoetry}
          onClose={() => setPoetryOpen(false)}
          onAddProsodyThemes={themeStore && missingProsody.length ? addProsodyThemes : undefined}
        />
        {activeJump && (
          <div role="status" className="basis-full flex items-center gap-2 text-[12px]">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500/60 shrink-0" />
            <span className="text-muted truncate">
              Tracing <strong className="text-stone-800 dark:text-paper">{activeJump.label ?? activeJump.terms?.join(', ')}</strong>, painted in the text
            </span>
            <button type="button" onClick={() => setActiveJump(null)} className="ml-auto caps caps-sm px-3 py-1 rounded-full border border-stone-300 dark:border-stone-600 hover:border-gold cursor-pointer">
              Clear
            </button>
          </div>
        )}
      </div>
      </FocusChrome>
      {focusMode && onToggleFocus && <FocusExit onExit={onToggleFocus} isDark={isDark} />}

      {/* Body: the text column, and the notes panel beside it (an overlay on a narrow window). */}
      <div ref={bodyRef} className="flex-1 flex max-w-6xl mx-auto w-full overflow-x-clip">
        {/* data-zoom-target: where the shelf's Read zoom lands page one (see zoomIntoReader in Bookshelf). */}
        <main
          ref={textRef}
          data-zoom-target
          data-annotation-surface
          tabIndex={-1}
          className={`flex-1 min-w-0 mx-auto w-full ${poetry.on ? 'pl-12 pr-5' : 'px-5'} space-y-6 ${spreadOn ? 'pt-5 pb-0' : 'py-6 pb-8'}`}
          style={{
            maxWidth: spreadOn ? undefined : `calc(42rem + ${marginMode === 'cards' ? MARGIN_CARDS_PX : marginMode === 'pins' ? MARGIN_PINS_PX : 0}px)`
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) clearSelection();
          }}
        >
          <AnimatePresence mode="wait" custom={slideDirection}>
            {activeControlTab === 'notes' && (
              <motion.div
                key="notes-tab"
                custom={slideDirection}
                variants={tabVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-6"
              >
                {spreadOn ? (
                  <TextSpread
                    ref={spreadHandle}
                    flowRef={setFlow}
                    reduced={Boolean(reduceMotion)}
                    initialElement={() => (spreadStartId.current ? document.getElementById(spreadStartId.current) : null)}
                    onTurn={() => {
                      clearSelection();
                      setSelectionAnchor(null);
                    }}
                    onSettle={(el) => {
                      spreadStartId.current = el?.id || null;
                    }}
                  >
                    {titleBlock}
                    {paragraphNodes}
                  </TextSpread>
                ) : (
                  <>
                    {titleBlock}
                    <div
                      ref={setFlow}
                      className="relative space-y-6"
                      style={{ marginRight: marginMode === 'cards' ? MARGIN_CARDS_PX : marginMode === 'pins' ? MARGIN_PINS_PX : 0 }}
                    >
                      {paragraphNodes}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {activeControlTab === 'board' && (
              <motion.div
                key="board-tab"
                custom={slideDirection}
                variants={tabVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="py-2 space-y-4"
              >
                <div className="flex items-center justify-between border-b pb-3 border-stone-200 dark:border-stone-800">
                  <div className="flex items-center gap-2">
                    <BoardIcon className="w-5 h-5 text-gold" />
                    <h3 className="title-hand text-[26px] text-stone-900 dark:text-paper">Excerpt board</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSwitchTab('notes')}
                    className="text-[12px] font-medium text-muted hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Reading</span>
                  </button>
                </div>
                <ExcerptBoard
                  items={boardItems}
                  marks={marks}
                  isDark={isDark}
                  onPlace={(id, at) => updateMarks([id], { board: at })}
                  onLink={(a, b) => annotations.commit((prev) => linkMarks(prev, a, b))}
                  onJump={(id) => {
                    select([id]);
                    handleSwitchTab('notes');
                    // The text tab mounts on the next frames; the navigator's retry does the same.
                    let tries = 0;
                    const go = () => !scrollToMarkRef.current(id) && ++tries < 20 && window.setTimeout(go, 60);
                    window.setTimeout(go, 260);
                  }}
                />
              </motion.div>
            )}

            {activeControlTab === 'export' && (
              <motion.div
                key="export-tab"
                custom={slideDirection}
                variants={tabVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="py-2 space-y-5"
              >
                <div className="flex items-center justify-between border-b pb-3 border-stone-200 dark:border-stone-800">
                  <div className="flex items-center gap-2">
                    <Download className="w-5 h-5 text-gold" />
                    <h3 className="title-hand text-[26px] text-stone-900 dark:text-paper">Export Annotations</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSwitchTab('notes')}
                    className="text-[12px] font-medium text-muted hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Reading</span>
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-stone-100 dark:bg-stone-800/60 flex items-center justify-between">
                    <div>
                      <h4 className="title-hand text-[21px] text-stone-900 dark:text-paper">{displayTitle}</h4>
                      <p className="text-[12px] text-muted">
                        {exportable.length} of {exportEntries.length} marks and notes match the filter below
                      </p>
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-accent text-on-accent">
                      {plural(exportable.length, 'Mark')}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[{ id: 'All', name: 'All' }, ...settings.activeThemes].map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setSelectedThemeFilter(theme.id)}
                        aria-pressed={selectedThemeFilter === theme.id}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                          selectedThemeFilter === theme.id
                            ? 'bg-accent text-on-accent shadow-xs'
                            : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
                        }`}
                      >
                        {theme.name}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(
                      [
                        { format: 'pdf', title: 'Download PDF', sub: 'Printable document' },
                        { format: 'markdown', title: 'Markdown (.md)', sub: 'For Obsidian / Notion' },
                        { format: 'txt', title: 'Plain Text (.txt)', sub: 'Universal text file' }
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.format}
                        type="button"
                        disabled={exportable.length === 0}
                        onClick={() => runExport(opt.format)}
                        className="p-4 rounded-2xl border border-stone-200 dark:border-stone-700 hover:border-gold dark:hover:border-gold text-left space-y-2 transition-all cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-stone-200 dark:disabled:hover:border-stone-700"
                      >
                        <Download className="w-5 h-5 text-gold group-hover:scale-110 transition-transform" />
                        <div>
                          <div className="font-bold text-[13px]">{opt.title}</div>
                          <div className="text-[11px] text-muted">{opt.sub}</div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="space-y-2 pt-2">
                    <h4 className="caps caps-sm text-muted">Every mark, for keeping</h4>
                    <ArchivePanel rows={archiveRows(archive, marks.length)} />
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>

        {/* The marks panel: every mark grouped by theme, with search and kind filters. Docked
            beside the text on a wide window (sticky under the header), an overlay on a narrow one. */}
        <aside
          aria-label="Marks"
          className={`flex-col min-h-0 border-l z-50 max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:w-full max-md:max-w-sm max-md:shadow-2xl md:sticky md:top-[calc(4.5rem+49px)] md:self-start md:h-[calc(100dvh-4.5rem-49px)] md:w-80 md:shrink-0 ${
            isPanelOpen ? 'flex motion-safe:animate-[panel-in_200ms_var(--ease-out)]' : 'hidden'
          } ${isDark ? 'bg-night-1 border-stone-800' : 'bg-white border-stone-200'}`}
        >
          <div className={`shrink-0 flex items-center justify-between px-3 py-2 border-b ${isDark ? 'border-stone-800' : 'border-stone-100'}`}>
            <h2 className="title-hand text-[24px] text-stone-900 dark:text-paper">
              {plural(views.length, 'mark')}
            </h2>
            <button type="button" onClick={() => setIsPanelOpen(false)} aria-label="Hide marks panel" className={iconBtn}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <NotesList
            annotations={views}
            settings={settings}
            isDark={isDark}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            onSelect={(a) => {
              select([a.id]);
              scrollToMark(a.id);
            }}
            onRetag={(id, themeId, color) => updateMarks([id], { themeId, color })}
            onDelete={deleteMark}
            onEdit={(id) => startEditing(id)}
            locationLabel={(a) => `Paragraph ${a.page}`}
          />
        </aside>
      </div>

      {/* Stepping through the marks the reader came here to find (opened from the library). */}
      {activeFocus && annotations.isLoaded && (
        <div className="fixed inset-x-0 bottom-0 max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] h-0 z-30">
          <InstanceNavigator
            focus={activeFocus}
            annotations={views}
            onGoTo={(a) => {
              setHoveredId(a.id);
              return scrollToMark(a.id);
            }}
            onClose={() => setActiveFocus(null)}
            isDark={isDark}
            locationLabel={(a) => `¶${a.page}`}
          />
        </div>
      )}

      {/* Properties for the selected mark: colour, weight, line style, note style, comment, delete. */}
      {selectedView && markRect && !editorOpen && (
        <MarkProperties
          mark={selectedView}
          rect={markRect}
          settings={settings}
          isDark={isDark}
          bottomInset={bottomInset}
          topInset={popoverTopInset}
          placementContext={placementContext}
          onColorChange={(color, themeId) => updateMarks([selectedView.id], { color, themeId })}
          onWeightChange={(weight) => updateMarks([selectedView.id], { weight })}
          onStrokeStyleChange={(strokeStyle) => updateMarks([selectedView.id], { strokeStyle })}
          onNoteStyleChange={(noteStyle) => updateMarks([selectedView.id], { noteStyle })}
          onTextSizeChange={(fontSize) => updateMarks([selectedView.id], { fontSize })}
          // Brackets and text boxes do not exist on text documents; their controls never show.
          onBracketSideChange={() => {}}
          onTextAlignChange={() => {}}
          onTextFontChange={() => {}}
          onTextBoldChange={() => {}}
          onTextItalicChange={() => {}}
          onEdit={() => startEditing(selectedView.id)}
          onDelete={() => deleteMark(selectedView.id)}
          onDismiss={clearSelection}
          onCopyQuote={selectedView.quote ? () => copyQuoteOf(selectedView.id, selectedView.quote!) : undefined}
          links={markLinksFor(selectedView.id)}
        />
      )}

      {archive.ui}

      {/* The selection menu — mark the passage, or write a note about it. */}
      {!editorOpen && activeControlTab === 'notes' && (
        <SelectionPopover
          anchor={selectionInView ? selectionAnchor : null}
          isDark={isDark}
          topInset={popoverTopInset}
          bottomInset={bottomInset}
          toolColors={toolColors}
          themes={settings.activeThemes}
          activeThemeId={activeThemeId}
          onThemeChange={setActiveThemeId}
          onCreateTheme={themeStore?.create}
          onCopyQuote={pendingSelection?.length ? () => copySelectionQuote(pendingSelection) : undefined}
          onMark={(kind) => {
            if (isReactionKind(kind as TextMarkKind)) createReactionForSelection(kind as TextMarkKind);
            else {
              if (pendingSelection?.length) applyMark(kind as 'highlight' | 'underline' | 'strikeout', pendingSelection);
              dropSelection();
            }
            setTool('select');
          }}
          onCreateNote={() => {
            createNoteForSelection();
            setTool('select');
          }}
          onMarkTerminology={() => {
            if (pendingSelection?.length) applyMark('terminology', pendingSelection);
            dropSelection();
            setTool('select');
          }}
          terminologyColor={settings.terminologyColor}
          onDismiss={() => setSelectionAnchor(null)}
          // Never over the text or a note card: the margin, above, below, the nav, or a gap.
          avoidSelector="[data-note-card]"
          placementContext={placementContext}
          onClose={dropSelection}
        />
      )}

      {/* Comment / note editor — the PDF workspace's, with a title for notes. Escape or Cancel
          discards the edit (a note still being written is never made). The backdrop does
          nothing when clicked: a stray click must neither save nor throw away words. */}
      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          // A press on the backdrop keeps focus where it was, inside the dialog.
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) e.preventDefault();
          }}
        >
          <div
            ref={editorRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reader-editor-title"
            className={`ink-card w-full max-w-sm rounded-2xl p-4 space-y-3 shadow-2xl ${
              isDark ? 'bg-night-3 border border-stone-800' : 'bg-white border border-stone-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editorColor }} />
              <h3 id="reader-editor-title" className="title-hand text-[23px] text-stone-900 dark:text-paper">
                {editorIsNote ? (newNote ? 'New note' : 'Note') : 'Comment'} · paragraph {editorPara + 1}
              </h3>
            </div>
            {editing && !editorIsNote && editing.quote && (
              <p
                className="text-[12px] italic text-stone-600 dark:text-stone-400 border-l-2 pl-2.5 line-clamp-3"
                style={{ borderLeftColor: editorColor }}
              >
                &ldquo;{viewById.get(editing.id)?.quote ?? editing.quote}&rdquo;
              </p>
            )}
            {editorIsNote && (
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Title (optional)"
                aria-label="Note title"
                className={`w-full px-3 py-2 rounded-xl border text-[13px] focus:outline-none focus:ring-1 focus:ring-gold ${
                  isDark ? 'bg-night-2 border-stone-800 text-stone-100 placeholder:text-paper/50' : 'bg-white border-stone-300 text-stone-900 placeholder:text-muted'
                }`}
              />
            )}
            {editorIsNote && (
              <textarea
                rows={2}
                value={draftQuote}
                onChange={(e) => setDraftQuote(e.target.value)}
                placeholder="Quoted excerpt (optional)"
                aria-label="Quoted excerpt"
                className={`w-full px-3 py-2 rounded-xl border border-l-[3px] text-[12.5px] italic leading-snug resize-none focus:outline-none focus:ring-1 focus:ring-gold ${
                  isDark ? 'bg-night-2 border-stone-800 text-stone-200 placeholder:text-paper/50' : 'bg-white border-stone-300 text-stone-700 placeholder:text-muted'
                }`}
                style={{ borderLeftColor: editorColor }}
              />
            )}
            <textarea
              autoFocus
              rows={4}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              aria-label={editorIsNote ? 'Note' : 'Comment'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEditing();
                }
              }}
              placeholder="Write your note… (Enter to save, Shift+Enter for a new line)"
              className={`w-full p-3 rounded-xl border text-[13px] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-gold ${
                isDark ? 'bg-night-2 border-stone-800 text-stone-100 placeholder:text-paper/50' : 'bg-white border-stone-300 text-stone-900 placeholder:text-muted'
              }`}
            />
            <div className="flex items-center gap-2">
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    deleteMark(editing.id);
                    closeEditor();
                  }}
                  className="text-[12px] font-semibold text-red-700 dark:text-red-400 hover:underline cursor-pointer"
                >
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={closeEditor}
                className={`px-4 py-2 rounded-full caps text-[12px] border cursor-pointer transition-colors ${
                  isDark ? 'border-stone-700 text-stone-200 hover:bg-nav-hover' : 'border-stone-300 text-stone-700 hover:bg-stone-100'
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEditing}
                className="px-4 py-2 rounded-full bg-accent caps hover:bg-accent-hover text-on-accent text-[12px] font-semibold cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
