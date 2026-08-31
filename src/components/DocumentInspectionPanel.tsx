import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Quote,
  Sparkles,
  MessageSquarePlus,
  Trash2,
  Check,
  FileText,
  FileCode,
  Bookmark,
  Pin,
  Highlighter,
  Bold,
  Eraser,
  ChevronDown,
  Palette,
  Underline,
  Circle
} from 'lucide-react';

import { exportAnnotatedDocument, CustomFormat, PreviewTheme, SymbolPattern, VocabularyTerm } from '../utils/documentExporter';
import { StickyNote } from '../types';
import { computeThemeIntervals, findThemeMentions } from '../utils/themeMatching';

export interface DocumentInspectionPanelProps {
  themes: PreviewTheme[];
  activeThemeId?: string;
  documentTitle?: string;
  documentText?: string;
  /** True when the source upload was a real PDF, whose paragraph chunks are native PDF pages rather than prose paragraphs. */
  isPdfSource?: boolean;
  isDark?: boolean;
  onClose: () => void;
  isDesktopSplit?: boolean;
  /** Notes for the active document, shared with the Reader screen so annotations don't fork per-screen. */
  notes: StickyNote[];
  onNotesChange: (updater: (prev: StickyNote[]) => StickyNote[]) => void;
  formats: CustomFormat[];
  onFormatsChange: (updater: (prev: CustomFormat[]) => CustomFormat[]) => void;
  authorName?: string;
  /** AI-derived analysis extras, carried through to the PDF/HTML export appendix. */
  executiveSummary?: string;
  symbols?: SymbolPattern[];
  favoriteQuotes?: string[];
  vocabulary?: VocabularyTerm[];
}

/**
 * A margin-column note's computed position, both as a lone card and as a member of a "deck" —
 * a cluster of notes anchored close enough together that stacking them at full height would
 * overlap or spill into neighboring paragraphs. `deckIndex` 0 is always the front (topmost
 * anchored) card in its deck; higher indices peek out from behind it when collapsed.
 */
interface NoteLayout {
  deckKey: string;
  deckIndex: number;
  deckSize: number;
  collapsedTop: number;
  expandedTop: number;
  height: number;
}

/** Minimal shape renderHighlightedText needs to draw a span's char-range highlight — deliberately not tied to StickyNote or any one annotation type. */
interface SpanAnchor {
  id?: string;
  start?: number;
  end?: number;
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

/**
 * Runs `callback` once web fonts have finished loading and the browser has painted at least
 * one frame after that — not just after a fixed short delay. A fixed timeout can fire before
 * fonts swap in on a cold page load/refresh, so note-card heights and highlighted-mark
 * positions get measured against fallback-font metrics; nothing re-measures them afterward, so
 * cards stay stacked as if they were the wrong (usually shorter) size — which is exactly why
 * refreshing left decks and arrows hanging too low until some unrelated change (like adding a
 * note) retriggered a measurement after fonts had actually settled in.
 */
function runAfterLayoutSettles(callback: () => void): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) callback();
  };
  const raf = () => requestAnimationFrame(() => requestAnimationFrame(run));
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(raf).catch(raf);
  } else {
    raf();
  }
  // Safety net in case fonts.ready never resolves.
  const fallback = setTimeout(run, 1200);
  return () => {
    cancelled = true;
    clearTimeout(fallback);
  };
}

/**
 * Waits until `getRect()` stops changing between animation frames before calling `onStable` —
 * used to defer a `scrollIntoView` until an ancestor's own layout transition has actually
 * finished, instead of guessing a fixed delay. The panel that hosts "jump to this theme's
 * mention" opens via a 500ms width transition on its parent split-pane PLUS its own 300ms
 * zoom/fade mount animation, both of which are still running at the exact moment a reader's
 * first tap opens it and fires the very first scroll. A short fixed timeout fired long before
 * either finished, so `scrollIntoView` measured a target position that hadn't reached its final
 * spot yet — the scroll landed short (or nowhere useful), and only on the FIRST tap, since every
 * later navigation happens once the panel has already settled and nothing is animating. Polling
 * the actual rect (rather than hard-coding either transition's duration) stays correct even if
 * those durations ever change.
 */
function waitForRectStable(getRect: () => DOMRect | null, onStable: () => void, maxWaitMs = 700): () => void {
  let cancelled = false;
  let lastRect: DOMRect | null = null;
  let stableFrames = 0;
  const start = performance.now();

  const check = () => {
    if (cancelled) return;
    const rect = getRect();
    const isSame =
      !!rect &&
      !!lastRect &&
      rect.top === lastRect.top &&
      rect.left === lastRect.left &&
      rect.width === lastRect.width &&
      rect.height === lastRect.height;
    stableFrames = isSame ? stableFrames + 1 : 0;
    lastRect = rect;

    if (stableFrames >= 3 || performance.now() - start > maxWaitMs) {
      onStable();
      return;
    }
    requestAnimationFrame(check);
  };

  requestAnimationFrame(check);
  return () => {
    cancelled = true;
  };
}

interface CharStyle {
  type: Set<string>;
  aiColor?: string;
  highlightColor?: string;
  underlineColor?: string;
  circleColor?: string;
  circleThickness?: number;
  ai?: boolean;
  removeBold?: boolean;
  removeUnderline?: boolean;
  removeHighlight?: boolean;
  annoIds: Set<string>;
}

/**
 * Builds the per-character style map one paragraph renders from: which theme(s) matched it,
 * which custom bold/highlight/underline/circle spans the reader applied, and any explicit
 * "undo the AI's default styling here" negation the reader applied on top of an AI match.
 * This is the single source of truth both `renderHighlightedText` (for drawing the paragraph)
 * and `resolveNoteColor` (for picking a new sticky note's color) read from, so a note's color
 * can never drift from what the reader actually sees highlighted on the page.
 */
function buildCharStyles(
  paraText: string,
  themes: PreviewTheme[],
  defaultColor: string,
  customFormats: CustomFormat[],
  pIdx?: number
): CharStyle[] {
  type FormatInterval = { start: number; end: number; type: CustomFormat['type'] | 'ai'; color?: string; thickness?: number };
  const intervals: FormatInterval[] = computeThemeIntervals(paraText, themes, pIdx).map((iv) => ({
    start: iv.start,
    end: iv.end,
    type: 'ai' as const,
    color: iv.color
  }));

  customFormats.forEach((cf) => {
    intervals.push({ start: cf.start, end: cf.end, type: cf.type, color: cf.color, thickness: cf.thickness });
  });

  // Each visual channel (AI tint, custom highlight, custom underline, circle) tracks its OWN
  // color, rather than one shared `color` field that later formats silently stomp. A reader's
  // explicit "remove-bold" / "remove-underline" / "remove-highlight" negation is tracked
  // separately too, so it can override the AI's own default styling on exactly the sub-span the
  // reader selected, without touching the AI match itself or any custom format layered on top.
  const charStyles: CharStyle[] = Array.from({ length: paraText.length }, () => ({ type: new Set(), annoIds: new Set() }));

  intervals.forEach((inter) => {
    for (let i = Math.max(0, inter.start); i < inter.end && i < paraText.length; i++) {
      if (inter.type === 'ai') {
        // Multiple themes can match the same characters (e.g. two themes both
        // claiming a whole paragraph). Rather than letting whichever theme
        // happens to iterate last silently win — which made the preview look
        // like one arbitrary, muddy color everywhere — the theme currently
        // being inspected (defaultColor) always takes visual priority, and the
        // first non-active theme to touch a character otherwise keeps its own
        // distinct color instead of being overwritten by a later one.
        const isActiveTheme = inter.color === defaultColor;
        if (!charStyles[i].ai || isActiveTheme) {
          charStyles[i].ai = true;
          charStyles[i].aiColor = inter.color;
        }
      } else if (inter.type === 'bold') {
        charStyles[i].type.add('bold');
      } else if (inter.type === 'highlight') {
        charStyles[i].type.add('highlight');
        charStyles[i].highlightColor = inter.color;
      } else if (inter.type === 'underline') {
        charStyles[i].type.add('underline');
        charStyles[i].underlineColor = inter.color;
      } else if (inter.type === 'circle') {
        charStyles[i].type.add('circle');
        charStyles[i].circleColor = inter.color;
        charStyles[i].circleThickness = inter.thickness;
      } else if (inter.type === 'remove-bold') {
        charStyles[i].removeBold = true;
      } else if (inter.type === 'remove-underline') {
        charStyles[i].removeUnderline = true;
      } else if (inter.type === 'remove-highlight') {
        charStyles[i].removeHighlight = true;
      }
    }
  });

  return charStyles;
}

function renderHighlightedText(
  paraText: string,
  themes: PreviewTheme[],
  defaultColor: string,
  customFormats: CustomFormat[] = [],
  annotations: SpanAnchor[] = [],
  hoveredAnnotationId: string | null = null,
  onFormatClick?: (start: number, end: number) => void,
  pIdx?: number
): React.ReactNode {
  const charStyles = buildCharStyles(paraText, themes, defaultColor, customFormats, pIdx);

  annotations.forEach(a => {
    if (a.id && a.start !== undefined && a.end !== undefined) {
      for (let i = Math.max(0, a.start); i < a.end && i < paraText.length; i++) {
        charStyles[i].annoIds.add(a.id);
      }
    }
  });

  const nodes: React.ReactNode[] = [];
  let currentGroup = '';

  const getStyleStr = (cs: typeof charStyles[0]) => {
    return `${cs.ai ? cs.aiColor : ''}-${cs.type.has('bold') ? 'b' : ''}-${cs.type.has('highlight') ? cs.highlightColor : ''}-${cs.type.has('underline') ? cs.underlineColor : ''}-${cs.type.has('circle') ? `${cs.circleColor}:${cs.circleThickness}` : ''}-${cs.removeBold ? 'rb' : ''}-${cs.removeUnderline ? 'ru' : ''}-${cs.removeHighlight ? 'rh' : ''}-${Array.from(cs.annoIds).join(',')}`;
  };

  const renderSpan = (text: string, styleInfo: typeof charStyles[0], key: number, start: number, end: number) => {
    if (!styleInfo.ai && styleInfo.type.size === 0 && styleInfo.annoIds.size === 0) return text;

    let bg = 'transparent';
    let fw = 'inherit';
    if (styleInfo.type.has('bold')) fw = 'bold';

    if (styleInfo.ai && !styleInfo.removeHighlight) {
      bg = `${styleInfo.aiColor || defaultColor}20`;
    }

    if (styleInfo.type.has('highlight')) {
      // A custom highlight always wins the background, regardless of whether the span is
      // also an AI match.
      bg = `${styleInfo.highlightColor || defaultColor}35`;
    }

    const hasUnderline = styleInfo.type.has('underline');
    const underlineColor = styleInfo.type.has('underline')
      ? (styleInfo.underlineColor || defaultColor)
      : (styleInfo.aiColor || defaultColor);

    const isHoveredAnno = hoveredAnnotationId && styleInfo.annoIds.has(hoveredAnnotationId);
    if (isHoveredAnno) {
      bg = '#fde047'; // Bright yellow cross-highlight
      fw = 'bold';
    }

    const isCircled = styleInfo.type.has('circle');
    const cls = isCircled
      ? 'inline-block'
      : isHoveredAnno ? 'px-1.5 rounded shadow-2xs' : styleInfo.ai ? 'px-1.5 rounded' : 'px-0.5 rounded-sm';

    let adjustedBg = bg;
    if (bg && bg === '#fef3c7') {
      adjustedBg = '#fde68a';
    }

    const firstAnnoId = Array.from(styleInfo.annoIds)[0];
    const matchingAnno = firstAnnoId ? annotations.find(a => a.id === firstAnnoId) : null;
    const isAnchor = matchingAnno && start <= matchingAnno.start! && end > matchingAnno.start!;
    const spanId = isAnchor ? `anno-span-${firstAnnoId}` : undefined;

    return (
      <mark
        id={spanId}
        key={`span-${key}`}
        className={`transition-all inline select-text ${cls}`}
        style={{
          backgroundColor: adjustedBg,
          textDecoration: hasUnderline ? 'underline' : 'none',
          textDecorationColor: hasUnderline ? underlineColor : 'transparent',
          textDecorationThickness: '2px',
          textUnderlineOffset: '5px',
          color: 'inherit',
          fontWeight: fw,
          ...(isCircled ? {
            border: `${styleInfo.circleThickness || 2}px solid ${styleInfo.circleColor || defaultColor}`,
            borderRadius: '50% / 30%',
            padding: '0.05em 0.4em',
            margin: '0 -0.15em'
          } : {})
        }}
      >
        {text}
      </mark>
    );
  };

  let currentStyleStr = charStyles.length > 0 ? getStyleStr(charStyles[0]) : '';

  charStyles.forEach((cs, i) => {
    const sStr = getStyleStr(cs);
    if (i === 0) {
      currentGroup += paraText[i];
    } else {
      if (sStr === currentStyleStr) {
        currentGroup += paraText[i];
      } else {
        const groupStart = i - currentGroup.length;
        nodes.push(renderSpan(currentGroup, charStyles[i - 1], nodes.length, groupStart, i));
        currentGroup = paraText[i];
        currentStyleStr = sStr;
      }
    }
  });

  if (currentGroup.length > 0) {
    const groupStart = paraText.length - currentGroup.length;
    nodes.push(renderSpan(currentGroup, charStyles[charStyles.length - 1], nodes.length, groupStart, paraText.length));
  }

  return nodes.length > 0 ? nodes : paraText;
}

function getSelectionCharacterOffsetWithin(element: HTMLElement) {
  let start = 0;
  let end = 0;
  const doc = element.ownerDocument || document;
  const win = doc.defaultView || window;
  let sel;
  if (typeof win.getSelection !== "undefined") {
    sel = win.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(element);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      start = preCaretRange.toString().length;
      end = start + range.toString().length;
    }
  }
  return { start, end };
}

function restoreSelectionCharacterOffset(element: HTMLElement, start: number, end: number) {
  const doc = element.ownerDocument || document;
  const win = doc.defaultView || window;
  if (typeof win.getSelection === "undefined") return;
  const sel = win.getSelection();
  if (!sel) return;

  let charCount = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startOffset = 0;
  let endOffset = 0;

  function traverseNodes(node: Node) {
    if (node.nodeType === 3) {
      const nextCharCount = charCount + (node.nodeValue?.length || 0);
      if (!startNode && start >= charCount && start <= nextCharCount) {
        startNode = node;
        startOffset = start - charCount;
      }
      if (!endNode && end >= charCount && end <= nextCharCount) {
        endNode = node;
        endOffset = end - charCount;
      }
      charCount = nextCharCount;
    } else {
      if (node.nodeType === 1 && node.childNodes) {
        for (let i = 0; i < node.childNodes.length; i++) {
          traverseNodes(node.childNodes[i]);
        }
      }
    }
  }

  traverseNodes(element);

  if (startNode && endNode) {
    const range = doc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/** "Does this exact sub-span already have unbroken coverage" check, used by
 * `toggleFormatRange` to decide whether toggling a format should add or remove it. */
function isRangeFullyCoveredByType(
  existing: { paragraphIndex: number; start: number; end: number; type: string }[],
  paragraphIndex: number,
  start: number,
  end: number,
  type: string
): boolean {
  const overlapping = existing
    .filter((cf) => cf.paragraphIndex === paragraphIndex && cf.type === type && rangesOverlap(cf, { start, end }))
    .sort((a, b) => a.start - b.start);
  let cursor = start;
  let fullyCovered = overlapping.length > 0;
  for (const iv of overlapping) {
    if (iv.start > cursor) {
      fullyCovered = false;
      break;
    }
    cursor = Math.max(cursor, iv.end);
    if (cursor >= end) break;
  }
  if (cursor < end) fullyCovered = false;
  return fullyCovered;
}

/** True only if every character in [start, end) is claimed by at least one theme's AI match. */
function isRangeFullyAiCovered(paraText: string, themes: PreviewTheme[], pIdx: number, start: number, end: number): boolean {
  const intervals = computeThemeIntervals(paraText, themes, pIdx);
  for (let i = start; i < end; i++) {
    if (!intervals.some((iv) => iv.start <= i && iv.end > i)) return false;
  }
  return end > start;
}

/**
 * Toggles a bold/highlight/underline format over [start, end) of one paragraph.
 *
 * If the selection is already fully covered by existing same-type format(s), those
 * formats are split so only the exact selected sub-span is un-formatted — any part
 * of an existing format outside the selection is preserved. Otherwise the selection
 * (merged with any formats it partially overlaps) is (re-)applied with `color`.
 *
 * This replaces the previous "remove the whole existing format node" behavior, which
 * dropped formatting well outside what the user actually selected.
 */
function toggleFormatRange(
  existing: CustomFormat[],
  paragraphIndex: number,
  start: number,
  end: number,
  type: CustomFormat['type'],
  color: string | undefined,
  thickness?: number
): CustomFormat[] {
  const untouched = existing.filter((cf) => !(cf.paragraphIndex === paragraphIndex && cf.type === type));
  const sameType = existing.filter((cf) => cf.paragraphIndex === paragraphIndex && cf.type === type);
  const overlapping = sameType.filter((cf) => rangesOverlap(cf, { start, end }));
  const nonOverlapping = sameType.filter((cf) => !overlapping.includes(cf));

  const fullyCovered = isRangeFullyCoveredByType(existing, paragraphIndex, start, end, type);

  if (fullyCovered) {
    // Remove: split each overlapping format around [start, end), keeping only the
    // leftover pieces that fall outside the toggled-off span.
    const remainder: CustomFormat[] = [];
    overlapping.forEach((cf) => {
      if (cf.start < start) remainder.push({ ...cf, end: Math.min(cf.end, start) });
      if (cf.end > end) remainder.push({ ...cf, start: Math.max(cf.start, end) });
    });
    return [...untouched, ...nonOverlapping, ...remainder];
  }

  // Apply: merge the new range with anything it already overlaps into one interval,
  // using the freshly-chosen color, instead of leaving stacked/duplicate formats.
  let mergedStart = start;
  let mergedEnd = end;
  overlapping.forEach((cf) => {
    mergedStart = Math.min(mergedStart, cf.start);
    mergedEnd = Math.max(mergedEnd, cf.end);
  });
  return [
    ...untouched,
    ...nonOverlapping,
    { paragraphIndex, start: mergedStart, end: mergedEnd, type, color, thickness }
  ];
}

export const DocumentInspectionPanel: React.FC<DocumentInspectionPanelProps> = ({
  themes = [],
  activeThemeId,
  documentTitle = 'The Architecture of Complexity',
  documentText,
  isPdfSource = false,
  isDark = false,
  onClose,
  isDesktopSplit = false,
  notes,
  onNotesChange,
  formats: customFormats,
  onFormatsChange,
  authorName,
  executiveSummary,
  symbols = [],
  favoriteQuotes = [],
  vocabulary = []
}) => {
  const activeTheme = themes.find(t => t.id === activeThemeId) || themes[0];
  const themeTitle = activeTheme?.title || 'Document Preview';
  const themeColor = activeTheme?.color || '#8b5cf6';
  const confidenceLabel = activeTheme?.confidenceLabel || '';
  const activeBorderColor = themeColor || '#8b5cf6';

  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [editingParagraphIndex, setEditingParagraphIndex] = useState<number | null>(null);
  const [noteInputText, setNoteInputText] = useState('');
  const [editingNoteRange, setEditingNoteRange] = useState<{start: number, end: number} | null>(null);
  const [editingNoteOffset, setEditingNoteOffset] = useState<number>(0);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [noteLayouts, setNoteLayouts] = useState<Record<string, NoteLayout>>({});
  const [expandedDeckKey, setExpandedDeckKey] = useState<string | null>(null);
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [selectedHighlightColor, setSelectedHighlightColor] = useState<string>(themeColor || '#8b5cf6');
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [selectedCircleColor, setSelectedCircleColor] = useState<string>('#ef4444');
  const [selectedCircleThickness, setSelectedCircleThickness] = useState<number>(2);
  const [isCircleOptionsOpen, setIsCircleOptionsOpen] = useState(false);
  const [staticLayouts, setStaticLayouts] = useState<Record<string, { startX: number; startY: number; marginColLeft: number }>>({});

  // Anchors each note's margin card to the precise line where its highlighted span begins
  // (getClientRects()[0], not getBoundingClientRect, because a mark that wraps across lines
  // would otherwise report a bounding box spanning every line it touches — we want just
  // where it starts, next to the selection), then, within each paragraph's margin column,
  // clusters notes whose ideal positions would collide into a single "deck of cards" instead
  // of stacking every one at full height — which used to push cards past the paragraph's own
  // row and into the next one whenever several notes anchored near each other. A deck's front
  // (topmost-anchored) card sits at its ideal position; the rest peek out a few pixels behind
  // it until the deck is hovered, when they fan out to their own full-height positions.
  useEffect(() => {
    return runAfterLayoutSettles(() => {
      const newLayouts: Record<string, NoteLayout> = {};

      const notesByPara = new Map<number, StickyNote[]>();
      notes.forEach((note) => {
        if (!note.id) return;
        const list = notesByPara.get(note.paragraphIndex) || [];
        list.push(note);
        notesByPara.set(note.paragraphIndex, list);
      });

      const PEEK = 10; // px each backing card peeks out from behind the one in front of it
      const GAP = 12; // px gap kept between separate decks (and between fanned-out cards)

      notesByPara.forEach((paraNotes, pIdx) => {
        const paraEl = document.getElementById(`inspection-paragraph-text-${pIdx}`);
        if (!paraEl) return;
        const paraRect = paraEl.getBoundingClientRect();

        const withIdeal = paraNotes.map((note) => {
          const markEl = document.getElementById(`anno-span-${note.id}`);
          let idealTop = 0;
          if (markEl) {
            const rects = markEl.getClientRects();
            const markRect = rects.length > 0 ? rects[0] : markEl.getBoundingClientRect();
            idealTop = Math.max(0, markRect.top - paraRect.top - 10);
          }
          const noteEl = document.getElementById(`note-card-${note.id}`);
          const height = noteEl ? noteEl.getBoundingClientRect().height : 70;
          return { id: note.id as string, idealTop, height };
        });

        withIdeal.sort((a, b) => a.idealTop - b.idealTop);

        // A note joins the deck being built only if it would genuinely overlap the most
        // recently placed member at that member's OWN full (uncollapsed) size — not merely
        // fall within the deck's already-shrunken collapsed footprint plus a gap, which used
        // to pull notes into a shared deck even when they wouldn't actually collide if left
        // at their natural positions. Anything that doesn't truly overlap starts its own deck
        // (of one) and renders as a normal, individual card.
        type Deck = { key: string; top: number; items: typeof withIdeal };
        const decks: Deck[] = [];
        withIdeal.forEach((item) => {
          const lastDeck = decks[decks.length - 1];
          const lastItem = lastDeck ? lastDeck.items[lastDeck.items.length - 1] : null;
          if (lastItem && item.idealTop < lastItem.idealTop + lastItem.height) {
            lastDeck!.items.push(item);
          } else {
            decks.push({ key: item.id, top: item.idealTop, items: [item] });
          }
        });

        // Decks themselves must not collide with each other either.
        let previousBottom = -Infinity;
        decks.forEach((deck) => {
          const collapsedHeight = deck.items[0].height + (deck.items.length - 1) * PEEK;
          deck.top = Math.max(deck.top, previousBottom + GAP);
          previousBottom = deck.top + collapsedHeight;

          let expandedCursor = deck.top;
          deck.items.forEach((item, idx) => {
            newLayouts[item.id] = {
              deckKey: deck.key,
              deckIndex: idx,
              deckSize: deck.items.length,
              collapsedTop: deck.top + idx * PEEK,
              expandedTop: expandedCursor,
              height: item.height
            };
            expandedCursor += item.height + GAP;
          });
        });
      });

      setNoteLayouts(newLayouts);
    });
  }, [notes, documentText]);

  // Measures the static anchor points for the arrows (the highlight in the text, and the left edge
  // of the margin column). We do this once after layout settles. The dynamic end-points of the arrows
  // are calculated mathematically during render so they instantly perfectly track the cards as they animate.
  useEffect(() => {
    return runAfterLayoutSettles(() => {
      const newStatic: Record<string, { startX: number; startY: number; marginColLeft: number }> = {};
      notes.forEach((note) => {
        if (!note.id) return;
        const markEl = document.getElementById(`anno-span-${note.id}`);
        const rowEl = document.getElementById(`inspection-paragraph-row-${note.paragraphIndex}`);
        const marginCol = document.getElementById(`margin-col-${note.paragraphIndex}`);
        if (!markEl || !rowEl || !marginCol) return;

        const markRects = markEl.getClientRects();
        const markRect = markRects.length > 0 ? markRects[0] : markEl.getBoundingClientRect();
        const rowRect = rowEl.getBoundingClientRect();
        const marginRect = marginCol.getBoundingClientRect();

        newStatic[note.id] = {
          startX: markRect.right - rowRect.left,
          startY: markRect.top + markRect.height / 2 - rowRect.top,
          marginColLeft: marginRect.left - rowRect.left
        };
      });
      setStaticLayouts(newStatic);
    });
  }, [notes, documentText]);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollToMentionCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (themeColor) {
      setSelectedHighlightColor(themeColor);
    }
  }, [themeColor]);

  const handleFormatText = (type: 'bold' | 'highlight' | 'underline' | 'circle', color?: string, thickness?: number) => {
    const sel = window.getSelection();

    if (!sel || sel.isCollapsed) return;

    let node: Node | null = sel.anchorNode;
    let paraEl: HTMLElement | null = null;
    let pIdx = -1;

    while (node && node !== document.body) {
      if (node instanceof HTMLElement && node.id && node.id.startsWith('inspection-paragraph-text-')) {
        paraEl = node;
        pIdx = parseInt(node.id.replace('inspection-paragraph-text-', ''), 10);
        break;
      }
      node = node.parentNode;
    }

    if (paraEl && pIdx !== -1) {
      const { start, end } = getSelectionCharacterOffsetWithin(paraEl);
      if (start !== end) {
        if (type === 'highlight') {
          // Highlight is the one format the AI still visibly applies on its own (the blue
          // background) — bold/underline no longer get AI-forced styling, so they can always
          // just add/remove their own plain format. If this span already carries a real custom
          // highlight, toggle that off normally. Otherwise, if it's only showing color because
          // the AI matched it, tapping Highlight should undo that default tint via a
          // `remove-highlight` negation (self-inverting: a second tap restores the AI color)
          // rather than stamping a new custom color on top of it — that's what made highlighting
          // AI text look like it "highlighted again" instead of toggling off.
          const paraText = paraEl.textContent || '';
          const hasCustom = isRangeFullyCoveredByType(customFormats, pIdx, start, end, type);
          const isAiCovered = !hasCustom && isRangeFullyAiCovered(paraText, themes, pIdx, start, end);

          if (isAiCovered) {
            onFormatsChange((prev) => toggleFormatRange(prev, pIdx, start, end, 'remove-highlight', undefined));
          } else {
            onFormatsChange((prev) => toggleFormatRange(prev, pIdx, start, end, type, color));
          }
        } else {
          // Bold, underline, and circle just add/remove their own plain custom format via the
          // standard toggle — none of them get AI-forced default styling to undo.
          onFormatsChange((prev) => toggleFormatRange(prev, pIdx, start, end, type, color, thickness));
        }

        // Keep the just-formatted text selected (so a second toolbar tap can stack
        // another format on it) — scoped to this exact action only, so it can never
        // fire again later for an unrelated formatting change and yank the user's
        // current selection back to stale coordinates.
        const targetParaEl = paraEl;
        setTimeout(() => {
          restoreSelectionCharacterOffset(targetParaEl, start, end);
        }, 0);
      }
    }
  };

  const handleRemoveFormatAt = (pIdx: number, spanStart: number, spanEnd: number) => {
    onFormatsChange((prev) => 
      prev.filter((cf) => {
        if (cf.paragraphIndex !== pIdx) return true;
        const overlaps = Math.max(cf.start, spanStart) < Math.min(cf.end, spanEnd);
        return !overlaps;
      })
    );
  };

  const paragraphs = React.useMemo(() => {
    if (documentText && documentText.trim()) {
      return documentText
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    }
    return [];
  }, [documentText]);

  // Built from the exact same strict interval-matching `renderHighlightedText` uses to draw
  // colored highlights, so "jump to mention" only ever lands on a paragraph that actually shows
  // a real, theme-colored highlight — never a guessed paragraph with nothing visibly matched.
  const mentionNodes = React.useMemo(() => {
    if (!activeTheme) return [];
    return findThemeMentions(paragraphs, activeTheme);
  }, [paragraphs, activeTheme]);

  const totalMentions = mentionNodes.length || 1;
  const activeMentionNode = mentionNodes[activeMentionIndex] || mentionNodes[0];

  const scrollToMention = React.useCallback((mentionIdx: number) => {
    const node = mentionNodes[mentionIdx];
    if (!node) return;
    const targetParaIdx = node.paragraphIndex;

    // Cancel any still-pending scroll from a previous call (e.g. rapid prev/next taps, or
    // switching themes again before the panel finished settling from the last switch) so an
    // earlier, now-stale scroll can never land after this newer one.
    scrollToMentionCancelRef.current?.();
    scrollToMentionCancelRef.current = waitForRectStable(
      () => containerRef.current?.getBoundingClientRect() ?? null,
      () => {
        const panelContainer = containerRef.current;
        const activeEl = panelContainer?.querySelector(`#inspection-paragraph-node-${targetParaIdx}`) as HTMLElement | null;
        if (activeEl) {
          try {
            activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (e) {
            activeEl.scrollIntoView();
          }
        }
      }
    );
  }, [mentionNodes]);

  // Whenever the inspected theme changes (tapping a different theme card), snap
  // straight to that theme's own first mention instead of leaving the viewport
  // wherever the previous theme's navigation last left it — and instead of trying
  // to keep the previous theme's mention index, which may be out of range (or just
  // wrong) for the newly active theme's own mention count.
  useEffect(() => {
    setActiveMentionIndex(0);
    scrollToMention(0);
    // Deliberately scoped to activeThemeId only: handlePrev/handleNext already
    // scroll explicitly on every step, so this shouldn't also re-fire whenever
    // `scrollToMention` is recreated for unrelated reasons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThemeId]);

  const handlePrev = () => {
    setActiveMentionIndex((prev) => {
      const next = prev > 0 ? prev - 1 : totalMentions - 1;
      scrollToMention(next);
      return next;
    });
  };

  const handleNext = () => {
    setActiveMentionIndex((prev) => {
      const next = prev < totalMentions - 1 ? prev + 1 : 0;
      scrollToMention(next);
      return next;
    });
  };

  /**
   * A note's color should match whatever highlight it's actually sitting on — the exact
   * custom-highlight color if the selection overlaps one, else the AI theme color if it
   * overlaps a theme match, else whatever color is currently armed in the toolbar. This reads
   * directly from `buildCharStyles` — the exact same per-character style map the paragraph
   * itself renders from — at the selection's own start index, instead of separately
   * recomputing overlaps with its own `rangesOverlap` pass. That guarantees a 100% match
   * between the note's color and whatever the reader visually sees highlighted at that spot,
   * including a `remove-highlight` override correctly hiding the AI color from consideration.
   */
  const resolveNoteColor = (pIdx: number, range: { start: number; end: number } | null): string => {
    if (!range) return selectedHighlightColor;

    const paraText = paragraphs[pIdx] || '';
    const paraFormats = customFormats.filter((cf) => cf.paragraphIndex === pIdx);
    const charStyles = buildCharStyles(paraText, themes, activeBorderColor, paraFormats, pIdx);
    const charStyle = charStyles[range.start];
    if (!charStyle) return selectedHighlightColor;

    if (charStyle.type.has('highlight') && charStyle.highlightColor) return charStyle.highlightColor;
    if (charStyle.ai && !charStyle.removeHighlight && charStyle.aiColor) return charStyle.aiColor;

    return selectedHighlightColor;
  };

  const handleAddAnnotation = (pIdx: number) => {
    if (!noteInputText.trim()) return;
    const quotedSpan = editingNoteRange
      ? paragraphs[pIdx]?.slice(editingNoteRange.start, editingNoteRange.end)
      : undefined;
    const newNote: StickyNote = {
      id: Math.random().toString(36).substr(2, 9),
      paragraphIndex: pIdx,
      start: editingNoteRange?.start,
      end: editingNoteRange?.end,
      title: 'Reader Note',
      content: noteInputText.trim(),
      quote: quotedSpan || undefined,
      author: authorName || 'Reader',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      color: resolveNoteColor(pIdx, editingNoteRange),
      isAiGenerated: false
    };
    onNotesChange((prev) => [...prev, newNote]);
    setNoteInputText('');
    setEditingParagraphIndex(null);
    setEditingNoteRange(null);
  };

  const handleDeleteAnnotation = (id: string) => {
    onNotesChange((prev) => prev.filter((n) => n.id !== id));
  };

  const handleExport = (format: 'pdf' | 'txt' | 'html' | 'docx') => {
    exportAnnotatedDocument({
      title: documentTitle,
      text: documentText,
      themes,
      annotations: notes.map((n) => ({
        id: n.id,
        paragraphIndex: n.paragraphIndex,
        start: n.start,
        end: n.end,
        noteText: n.content,
        timestamp: n.timestamp,
        color: n.color
      })),
      customFormats,
      executiveSummary,
      symbols,
      favoriteQuotes,
      vocabulary,
      isPdfSource,
      format
    });
    setIsDownloadMenuOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`fixed lg:absolute inset-0 w-full h-full z-100 lg:z-0 lg:border-l lg:border-stone-200/50 dark:border-stone-800/50 flex flex-col overflow-hidden transition-all duration-300 animate-in zoom-in-95 fade-in ease-out ${
        isDark ? 'bg-[#121513] text-stone-100' : 'bg-[#fafaf9] text-stone-900'
      }`}
    >
      <header className="px-5 py-4 border-b border-stone-200/50 dark:border-stone-800/50 shrink-0 bg-stone-50/70 dark:bg-[#121513]/70 backdrop-blur-xl saturate-150 z-20">
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-3 h-3 rounded-full shrink-0 shadow-2xs"
              style={{ backgroundColor: activeBorderColor }}
            />
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="font-serif text-[15px] sm:text-[16px] font-bold truncate text-stone-900 dark:text-white">
                {themeTitle}
              </h3>
              <span className="hidden sm:inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 shrink-0">
                {confidenceLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <div 
                className="flex items-center gap-0.5 p-0.5 rounded-full border shrink-0 transition-colors"
                style={{ 
                  backgroundColor: `${activeBorderColor}15`, 
                  borderColor: `${activeBorderColor}30` 
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePrev();
                  }}
                  className="p-1.5 rounded-full hover:bg-white dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 transition-transform duration-150 active:scale-[0.97] cursor-pointer"
                  title="Previous Mention"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                <span className="px-1.5 text-[10px] font-bold text-stone-700 dark:text-stone-300 font-mono shrink-0">
                  {activeMentionIndex + 1} / {totalMentions}
                </span>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNext();
                  }}
                  className="p-1.5 rounded-full hover:bg-white dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 transition-transform duration-150 active:scale-[0.97] cursor-pointer"
                  title="Next Mention"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setIsDownloadMenuOpen((prev) => !prev)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 text-[12px] font-medium hover:scale-105 active:scale-[0.97] transition-transform duration-150 shadow-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Export</span>
                </button>
                {isDownloadMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-40 rounded-xl bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 shadow-xl overflow-hidden z-50 animate-in slide-in-from-top-2 fade-in">
                    <button onClick={() => handleExport('html')} className="w-full text-left px-4 py-2.5 text-[13px] font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 flex items-center gap-2 cursor-pointer transition-colors">
                      <FileCode className="w-4 h-4 text-orange-500" /> HTML Export
                    </button>
                    <button onClick={() => handleExport('pdf')} className="w-full text-left px-4 py-2.5 text-[13px] font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 flex items-center gap-2 cursor-pointer transition-colors">
                      <FileText className="w-4 h-4 text-red-500" /> PDF Format
                    </button>
                    <button onClick={() => handleExport('docx')} className="w-full text-left px-4 py-2.5 text-[13px] font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 flex items-center gap-2 cursor-pointer transition-colors">
                      <Bookmark className="w-4 h-4 text-blue-500" /> DOCX Format
                    </button>
                    <button onClick={() => handleExport('txt')} className="w-full text-left px-4 py-2.5 text-[13px] font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 flex items-center gap-2 cursor-pointer transition-colors">
                      <FileText className="w-4 h-4 text-stone-500" /> Plain Text
                    </button>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full border border-stone-300/80 dark:border-stone-700/80 bg-stone-200/50 dark:bg-stone-800/50 hover:bg-stone-300/50 dark:hover:bg-stone-700/50 text-stone-500 hover:text-stone-900 dark:hover:text-white transition-transform duration-150 active:scale-[0.97] cursor-pointer shrink-0"
              title="Close Reader"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div
        id="document-inspection-scroll-container"
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 sm:p-8 lg:p-12 scroll-smooth"
      >
        <div className="max-w-6xl mx-auto space-y-12">
        {paragraphs.map((paraText, pIdx) => {
          const pageMarkerMatch = paraText.match(/^--- Page (\d+) ---$/);
          if (pageMarkerMatch) {
            return (
              <div key={pIdx} className="flex items-center justify-center my-8 py-4 opacity-70">
                <div className="h-px bg-stone-200 dark:bg-stone-800 flex-1" />
                <span className="px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500 font-serif">
                  Page {pageMarkerMatch[1]}
                </span>
                <div className="h-px bg-stone-200 dark:bg-stone-800 flex-1" />
              </div>
            );
          }

          const paraAnnotations = notes.filter((a) => a.paragraphIndex === pIdx);

          // The margin column's height must actually cover wherever its notes currently sit —
          // collapsed into their decks, or fanned out because one deck is expanded — so the
          // paragraph row this column belongs to grows to contain them instead of letting their
          // cards (and the arrows pointing at them) bleed down into the next paragraph's row.
          const marginColumnHeight = paraAnnotations.reduce((max, anno) => {
            const layout = anno.id ? noteLayouts[anno.id] : undefined;
            if (!layout) return max;
            const top = expandedDeckKey === layout.deckKey ? layout.expandedTop : layout.collapsedTop;
            return Math.max(max, top + layout.height);
          }, 0);

          return (
            <div
              key={pIdx}
              id={`inspection-paragraph-node-${pIdx}`}
              className="p-5 sm:p-8 rounded-3xl border border-stone-200/80 dark:border-stone-800/80 bg-white/60 dark:bg-stone-900/30 hover:border-stone-300 dark:hover:border-stone-700 transition-all shadow-sm"
            >
              <div className="flex items-center justify-between gap-x-2 mb-4 pb-3 border-b border-stone-200/50 dark:border-stone-800/50">
                <div className="flex items-center gap-2 shrink-0 overflow-hidden text-[12px] text-stone-500 dark:text-stone-400">
                  <span className="font-medium uppercase tracking-wider">
                    {isPdfSource ? `Page ${pIdx + 1}` : `Paragraph ${pIdx + 1}`}
                  </span>
                </div>
                
                <div className="flex items-center gap-3 shrink-0 relative">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNoteRange(null);
                      setEditingParagraphIndex(editingParagraphIndex === pIdx ? null : pIdx);
                    }}
                    className="flex items-center gap-1.5 text-[12px] font-bold text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white cursor-pointer bg-stone-100 dark:bg-stone-800 px-3 py-1.5 rounded-lg transition-colors active:scale-[0.97]"
                  >
                    <MessageSquarePlus className="w-4 h-4 text-stone-500" />
                    <span className="hidden sm:inline">Add Note</span>
                  </button>
                </div>
              </div>
              <div id={`inspection-paragraph-row-${pIdx}`} className="flex flex-col lg:flex-row gap-8 lg:gap-12 items-start relative">
                {paraAnnotations.length > 0 && (
                  <svg className="hidden lg:block pointer-events-none absolute inset-0 w-full h-full z-20" style={{ overflow: 'visible' }}>
                    {paraAnnotations.map((anno) => {
                      if (!anno.id) return null;
                      const layout = noteLayouts[anno.id];
                      const staticLayout = staticLayouts[anno.id];
                      if (!layout || !staticLayout) return null;

                      // Only draw arrow for front card, unless the deck is expanded
                      const isExpanded = expandedDeckKey === layout.deckKey;
                      if (layout.deckIndex > 0 && !isExpanded) return null;

                      const { startX, startY, marginColLeft } = staticLayout;
                      const peekInset = !isExpanded ? layout.deckIndex * 3 : 0;
                      const endX = marginColLeft + 8 + peekInset; // 0.5rem = 8px
                      const endY = (isExpanded ? layout.expandedTop : layout.collapsedTop) + (layout.height / 2);

                      const dx = endX - startX;
                      const dipY = (startY + endY) / 2 + Math.abs(dx) * 0.08 + 10;
                      const c1x = startX + dx * 0.35;
                      const c1y = dipY;
                      const c2x = startX + dx * 0.75;
                      const c2y = endY;
                      const d = `M ${startX} ${startY} C ${c1x} ${c1y} ${c2x} ${c2y} ${endX} ${endY}`;

                      const isHovered = hoveredAnnotationId === anno.id;
                      const isBackgroundDeck = expandedDeckKey !== null && !isExpanded;
                      const isAnotherHovered = hoveredAnnotationId !== null && !isHovered;
                      const isBlurred = isBackgroundDeck || isAnotherHovered;

                      return (
                        <g key={anno.id}>
                          <defs>
                            <marker id={`arrowhead-${anno.id}`} markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
                              <path 
                                d="M0,0 L6,3 L0,6 Z" 
                                fill={anno.color || activeBorderColor} 
                                style={{ transition: 'fill 350ms cubic-bezier(0.16,1,0.3,1)' }}
                              />
                            </marker>
                          </defs>
                          <path
                            d={d}
                            fill="none"
                            stroke={anno.color || activeBorderColor}
                            strokeWidth="1.5"
                            strokeDasharray="4 3"
                            strokeLinecap="round"
                            opacity={isHovered ? 0.9 : isBlurred ? 0.15 : 0.45}
                            markerEnd={`url(#arrowhead-${anno.id})`}
                            style={{
                              transition: 'd 350ms cubic-bezier(0.16,1,0.3,1), opacity 200ms ease, filter 200ms ease, stroke 350ms ease',
                              filter: isBlurred ? 'blur(2px)' : 'none'
                            }}
                          />
                        </g>
                      );
                    })}
                  </svg>
                )}
                <div className="w-full lg:flex-1 lg:min-w-0 relative">
                  <p id={`inspection-paragraph-text-${pIdx}`} className="font-serif text-[15px] leading-relaxed text-stone-600 dark:text-stone-400 select-text touch-auto relative z-10">
                    {renderHighlightedText(
                      paraText, themes, activeBorderColor,
                      customFormats.filter(cf => cf.paragraphIndex === pIdx),
                      paraAnnotations,
                      hoveredAnnotationId,
                      (start, end) => handleRemoveFormatAt(pIdx, start, end),
                      pIdx
                    )}
                  </p>
                </div>

                <div
                  id={`margin-col-${pIdx}`}
                  className="hidden lg:block lg:w-[30%] xl:w-[25%] shrink-0 relative z-10 min-h-10 mt-4 lg:mt-0 transition-[height] duration-300"
                  style={marginColumnHeight > 0 ? { minHeight: `${marginColumnHeight + 16}px` } : undefined}
                >
                  {paraAnnotations.length > 0 && (() => {
                    // Group this paragraph's notes by deck so each deck can get a single
                    // continuous hover region spanning its own full bounding box — cards
                    // included, gaps between them included. Hovering a gap between two fanned
                    // cards used to fall through to neither one's mouseenter, firing a
                    // mouseleave that collapsed the deck out from under the cursor and made
                    // hovering feel like it randomly opened and closed. With one wrapper owning
                    // enter/leave for the whole deck, the gaps are just as "inside" as the cards.
                    const deckGroups = new Map<string, typeof paraAnnotations>();
                    paraAnnotations.forEach((anno, aIdx) => {
                      const layout = anno.id ? noteLayouts[anno.id] : undefined;
                      const key = layout?.deckKey || anno.id || `solo-${aIdx}`;
                      const list = deckGroups.get(key) || [];
                      list.push(anno);
                      deckGroups.set(key, list);
                    });

                    return (
                      <div className="w-full h-full relative opacity-90 hover:opacity-100 transition-opacity">
                        {Array.from(deckGroups.entries()).map(([deckKey, members]) => {
                          const isExpanded = expandedDeckKey === deckKey;
                          const memberLayouts = members.map((m) => (m.id ? noteLayouts[m.id] : undefined));
                          const tops = memberLayouts.map((l) => l?.collapsedTop ?? 0);
                          const wrapperTop = tops.length > 0 ? Math.min(...tops) : 0;
                          const bottoms = memberLayouts.map(
                            (l) => (isExpanded ? l?.expandedTop ?? 0 : l?.collapsedTop ?? 0) + (l?.height ?? 70)
                          );
                          const wrapperHeight = Math.max(40, (bottoms.length > 0 ? Math.max(...bottoms) : 70) - wrapperTop);
                          // Not part of the deck the reader is currently focused on (some deck
                          // IS expanded, just not this one) — recede into the background so it
                          // doesn't visually compete with the stack actually being read.
                          const isBackgroundDeck = expandedDeckKey !== null && !isExpanded;

                          return (
                            <div
                              key={deckKey}
                              className="absolute"
                              onMouseEnter={() => setExpandedDeckKey(deckKey)}
                              onMouseLeave={() => setExpandedDeckKey((prev) => (prev === deckKey ? null : prev))}
                              style={{
                                top: `${wrapperTop}px`,
                                left: 0,
                                right: 0,
                                height: `${wrapperHeight}px`,
                                zIndex: isExpanded ? 999 : undefined,
                                transition: 'height 350ms cubic-bezier(0.16,1,0.3,1), top 350ms cubic-bezier(0.16,1,0.3,1)'
                              }}
                            >
                              {members.map((anno, aIdx) => {
                                const layout = anno.id ? noteLayouts[anno.id] : undefined;
                                const isHovered = hoveredAnnotationId === anno.id;
                                const deckIndex = layout?.deckIndex ?? 0;
                                const deckSize = layout?.deckSize ?? 1;
                                // Peeking cards behind the front one inset a few px per position
                                // so a sliver of each is visible, like a fanned pile of index
                                // cards — only while collapsed; expanded cards sit full-width at
                                // their own fanned-out position instead.
                                const peekInset = !isExpanded ? deckIndex * 3 : 0;
                                const top = (layout ? (isExpanded ? layout.expandedTop : layout.collapsedTop) : aIdx * 40) - wrapperTop;

                                return (
                                  <div
                                    key={aIdx}
                                    id={`note-card-${anno.id}`}
                                    className="absolute p-2.5 rounded-xl shadow-lg border pointer-events-auto group"
                                    onMouseEnter={() => setHoveredAnnotationId(anno.id || null)}
                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                    style={{
                                      top: `${top}px`,
                                      left: `calc(0.5rem + ${peekInset}px)`,
                                      right: `calc(0.5rem + ${peekInset}px)`,
                                      maxWidth: 'calc(100% - 1rem)',
                                      // `ease-in-out` (a strong custom curve, not the weak CSS
                                      // default) for the position/shape change, since these cards
                                      // are already on screen and moving to a new spot rather
                                      // than entering fresh; a quicker plain `ease` for
                                      // color/blur, which don't have a "shape" to feel the easing
                                      // of. Listed explicitly (never `transition: all`) so
                                      // nothing unintended rides along and animates too.
                                      transition:
                                        'top 350ms cubic-bezier(0.16,1,0.3,1), left 350ms cubic-bezier(0.16,1,0.3,1), ' +
                                        'right 350ms cubic-bezier(0.16,1,0.3,1), transform 350ms cubic-bezier(0.16,1,0.3,1), ' +
                                        'filter 200ms ease, opacity 200ms ease, background-color 200ms ease, border-color 200ms ease',
                                      transitionDelay: isExpanded ? `${deckIndex * 20}ms` : '0ms',
                                      // Rows aren't isolated stacking contexts, so z-index
                                      // compares globally across the whole document — the
                                      // expanded deck (or the one card actively hovered within
                                      // it) needs a z-index far above the everyday 20-ish range
                                      // every other card uses, or it can end up rendering BEHIND
                                      // some other paragraph's notes instead of on top of
                                      // literally everything, which is the whole point of hover.
                                      zIndex: isHovered ? 1050 : isExpanded ? 1000 + aIdx : 20 + (deckSize - deckIndex),
                                      backgroundColor: isHovered ? '#fef08a' : `color-mix(in srgb, ${anno.color || activeBorderColor} 35%, ${isDark ? '#292524' : '#ffffff'})`,
                                      borderColor: isHovered ? '#eab308' : `${anno.color || activeBorderColor}60`,
                                      filter: isBackgroundDeck ? 'blur(3px)' : 'none',
                                      opacity: isBackgroundDeck ? 0.5 : 1,
                                      transform: isHovered
                                        ? 'scale(1.04) rotate(0deg) translateX(-8px)'
                                        : !isExpanded && deckIndex > 0
                                          ? `scale(${Math.max(0.9, 1 - deckIndex * 0.03)}) rotate(${-2 + (deckIndex % 3) * 1.5}deg) translateY(${deckIndex * 2}px)`
                                          : 'rotate(-2deg)'
                                    }}
                                  >
                                    {!isExpanded && deckIndex === 0 && deckSize > 1 && (
                                      <span
                                        className="absolute -top-2 -left-2 min-w-4.5 h-4.5 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center shadow-sm"
                                        style={{ backgroundColor: anno.color || activeBorderColor }}
                                      >
                                        +{deckSize - 1}
                                      </span>
                                    )}
                                    <button
                                      onClick={() => handleDeleteAnnotation(anno.id)}
                                      className="absolute -top-2 -right-2 p-1 bg-white dark:bg-stone-800 text-stone-400 hover:text-red-500 rounded-full shadow-sm border border-stone-200 dark:border-stone-700 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                                      title="Delete Note"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                    <p className="font-handwriting text-[15px] leading-tight font-bold text-stone-900 dark:text-stone-100">
                                      &ldquo;{anno.content}&rdquo;
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  
                  {editingParagraphIndex === pIdx && (
                    <div
                      className="absolute p-3 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-right-4 transform -rotate-1"
                      style={{
                        top: `${editingNoteOffset}px`,
                        left: '0.5rem',
                        right: '0.5rem',
                        maxWidth: 'calc(100% - 1rem)',
                        // Above even an expanded deck's 1050 hover z-index — the note the reader
                        // is actively composing should never be able to end up buried under one.
                        zIndex: 2000,
                        backgroundColor: `color-mix(in srgb, ${selectedHighlightColor} 35%, ${isDark ? '#292524' : '#ffffff'})`,
                        borderColor: `${selectedHighlightColor}80`,
                        borderWidth: '1px'
                      }}
                    >
                      <textarea
                        autoFocus
                        value={noteInputText}
                        onChange={(e) => setNoteInputText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAddAnnotation(pIdx);
                          }
                        }}
                        placeholder="Type your marginalia..."
                        className="w-full bg-transparent border-b p-2 text-[15px] leading-tight font-bold font-handwriting min-h-20 focus:outline-none resize-none text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500"
                        style={{ borderBottomColor: `${selectedHighlightColor}40` }}
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingParagraphIndex(null);
                            setEditingNoteRange(null);
                          }}
                          className="px-3 py-1.5 text-xs font-bold text-stone-600 dark:text-stone-300 hover:opacity-70 transition-opacity cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddAnnotation(pIdx)}
                          className="px-3 py-1.5 text-xs font-bold text-white rounded-lg shadow-md hover:brightness-110 transition-all cursor-pointer"
                          style={{ backgroundColor: selectedHighlightColor }}
                        >
                          Save Note
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {(paraAnnotations.length > 0 || editingParagraphIndex === pIdx) && (
                  <div className="lg:hidden md:col-span-12 space-y-3 pt-3 border-t border-stone-200/60 dark:border-stone-800 mt-4">
                    {paraAnnotations.length > 0 && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block mb-1 font-mono">
                        MARGINALIA NOTE
                      </span>
                    )}
                    {paraAnnotations.map((anno, aIdx) => (
                      <div
                        key={aIdx}
                        onClick={() => {
                          const newId = hoveredAnnotationId === anno.id ? null : (anno.id || null);
                          setHoveredAnnotationId(newId);
                          if (newId) {
                            setTimeout(() => {
                              const el = document.getElementById(`anno-span-${newId}`);
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 50);
                          }
                        }}
                        className="relative p-3.5 rounded-2xl shadow-md -rotate-1 hover:rotate-0 transition-all duration-200 border cursor-pointer select-none"
                        style={{
                          backgroundColor: hoveredAnnotationId === anno.id ? '#fef08a' : `color-mix(in srgb, ${anno.color || activeBorderColor} 35%, ${isDark ? '#292524' : '#ffffff'})`,
                          borderColor: hoveredAnnotationId === anno.id ? '#eab308' : `${anno.color || activeBorderColor}80`,
                          transform: hoveredAnnotationId === anno.id ? 'scale(1.02) rotate(0deg)' : 'rotate(-1deg)'
                        }}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <div className="flex items-center gap-1.5 opacity-60">
                            <Pin className="w-3.5 h-3.5 -rotate-45" />
                            <span className="text-[10px] font-bold uppercase tracking-wide">
                              {anno.timestamp}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAnnotation(anno.id);
                            }}
                            className="p-1 text-stone-400 hover:text-red-500 transition-colors cursor-pointer z-10 relative"
                            title="Delete Note"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="font-handwriting text-[18px] leading-snug font-bold text-stone-900 dark:text-stone-100">
                          &ldquo;{anno.content}&rdquo;
                        </p>
                      </div>
                    ))}
                    
                    {editingParagraphIndex === pIdx && (
                      <div
                        className="relative p-3.5 rounded-2xl shadow-xl"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${selectedHighlightColor} 35%, ${isDark ? '#292524' : '#ffffff'})`,
                          borderColor: `${selectedHighlightColor}80`,
                          borderWidth: '1px'
                        }}
                      >
                        <textarea
                          autoFocus
                          value={noteInputText}
                          onChange={(e) => setNoteInputText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleAddAnnotation(pIdx);
                            }
                          }}
                          placeholder="Type your marginalia..."
                          className="w-full bg-transparent border-b p-2 text-[18px] leading-snug font-bold font-handwriting min-h-20 focus:outline-none resize-none text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500"
                          style={{ borderBottomColor: `${selectedHighlightColor}40` }}
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingParagraphIndex(null);
                              setEditingNoteRange(null);
                            }}
                            className="px-3 py-1.5 text-xs font-bold text-stone-600 dark:text-stone-300 hover:opacity-70 transition-opacity cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAddAnnotation(pIdx)}
                            className="px-3 py-1.5 text-xs font-bold text-white rounded-lg shadow-md hover:brightness-110 transition-all cursor-pointer"
                            style={{ backgroundColor: selectedHighlightColor }}
                          >
                            Save Note
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {/* Reserves scroll room below the last paragraph so the floating format toolbar —
            always-on and positioned relative to this same scroll container, not the viewport —
            can never permanently sit on top of it with no way to scroll it clear. Taller on
            small screens, where the single-column layout puts full-width paragraph text right
            where the toolbar floats. */}
        <div className="h-24 sm:h-16 lg:h-8" aria-hidden="true" />
      </div>

      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-40">
        <div className="relative flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-stone-900/90 dark:bg-stone-800/90 backdrop-blur-md border border-stone-700/80 text-white shadow-2xl transition-all active:scale-[0.98]">
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); handleFormatText('bold'); }}
            className="p-1.5 rounded-full hover:bg-stone-700/80 text-stone-300 hover:text-white transition-all cursor-pointer"
            title="Format Bold"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); handleFormatText('underline', selectedHighlightColor); }}
            className="p-1.5 rounded-full hover:bg-stone-700/80 text-stone-300 hover:text-white transition-all cursor-pointer"
            title="Underline"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-3.5 bg-stone-700 mx-0.5" />

          <div className="relative flex items-center color-picker-container">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                const sel = window.getSelection();
                if (sel && !sel.isCollapsed) {
                  handleFormatText('highlight', selectedHighlightColor);
                } else {
                  setIsColorPickerOpen((prev) => !prev);
                }
              }}
              className="flex items-center gap-1.5 p-1.5 rounded-full hover:bg-stone-700/80 text-stone-300 hover:text-white transition-all cursor-pointer"
              title="Highlight Text"
            >
              <Highlighter className="w-3.5 h-3.5" style={{ color: selectedHighlightColor }} />
              <span
                className="w-2.5 h-2.5 rounded-full ring-1 ring-black/30 shrink-0"
                style={{ backgroundColor: selectedHighlightColor }}
              />
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                setIsColorPickerOpen((prev) => !prev);
              }}
              className="p-1 rounded-full hover:bg-stone-700/80 text-stone-400 hover:text-white transition-all cursor-pointer"
              title="Choose Highlight Color"
            >
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isColorPickerOpen ? 'rotate-180' : ''}`} />
            </button>

            {isColorPickerOpen && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 p-2 rounded-2xl bg-stone-900/95 dark:bg-stone-800/95 border border-stone-700 shadow-2xl z-50 flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-150 shrink-0">
                {[
                  { label: 'Theme Default', value: activeBorderColor },
                  { label: 'Yellow', value: '#fde047' },
                  { label: 'Amber', value: '#fbbf24' },
                  { label: 'Emerald', value: '#34d399' },
                  { label: 'Sky Blue', value: '#38bdf8' },
                  { label: 'Purple', value: '#a78bfa' },
                  { label: 'Rose', value: '#f472b6' }
                ].map((swatch) => (
                  <button
                    key={swatch.value}
                    type="button"
                    title={swatch.label}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setSelectedHighlightColor(swatch.value);
                      const sel = window.getSelection();
                      if (sel && !sel.isCollapsed) {
                        handleFormatText('highlight', swatch.value);
                      }
                      setIsColorPickerOpen(false);
                    }}
                    className={`w-6 h-6 rounded-full transition-transform active:scale-90 hover:scale-110 flex items-center justify-center border ${
                      selectedHighlightColor === swatch.value
                        ? 'ring-2 ring-offset-1 ring-white scale-105'
                        : 'border-stone-600'
                    }`}
                    style={{ backgroundColor: swatch.value }}
                  >
                    {swatch.value === activeBorderColor && (
                      <Palette className="w-3 h-3 text-stone-700 mix-blend-difference" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="w-px h-3.5 bg-stone-700 mx-0.5" />

          <div className="relative flex items-center circle-picker-container">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                const sel = window.getSelection();
                if (sel && !sel.isCollapsed) {
                  handleFormatText('circle', selectedCircleColor, selectedCircleThickness);
                } else {
                  setIsCircleOptionsOpen((prev) => !prev);
                }
              }}
              className="flex items-center gap-1.5 p-1.5 rounded-full hover:bg-stone-700/80 text-stone-300 hover:text-white transition-all cursor-pointer"
              title="Circle Text"
            >
              <Circle className="w-3.5 h-3.5" style={{ color: selectedCircleColor }} />
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                setIsCircleOptionsOpen((prev) => !prev);
              }}
              className="p-1 rounded-full hover:bg-stone-700/80 text-stone-400 hover:text-white transition-all cursor-pointer"
              title="Circle Options"
            >
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isCircleOptionsOpen ? 'rotate-180' : ''}`} />
            </button>

            {isCircleOptionsOpen && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 p-2.5 rounded-2xl bg-stone-900/95 dark:bg-stone-800/95 border border-stone-700 shadow-2xl z-50 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-150 shrink-0 w-max">
                <div className="flex items-center gap-1.5">
                  {[
                    { label: 'Red', value: '#ef4444' },
                    { label: 'Amber', value: '#fbbf24' },
                    { label: 'Emerald', value: '#34d399' },
                    { label: 'Sky Blue', value: '#38bdf8' },
                    { label: 'Purple', value: '#a78bfa' }
                  ].map((swatch) => (
                    <button
                      key={swatch.value}
                      type="button"
                      title={swatch.label}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setSelectedCircleColor(swatch.value);
                        const sel = window.getSelection();
                        if (sel && !sel.isCollapsed) {
                          handleFormatText('circle', swatch.value, selectedCircleThickness);
                        }
                      }}
                      className={`w-6 h-6 rounded-full transition-transform active:scale-90 hover:scale-110 border ${
                        selectedCircleColor === swatch.value
                          ? 'ring-2 ring-offset-1 ring-white scale-105'
                          : 'border-stone-600'
                      }`}
                      style={{ backgroundColor: swatch.value }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5 pt-1.5 border-t border-stone-700/80">
                  {[1, 2, 3].map((px) => (
                    <button
                      key={px}
                      type="button"
                      title={`${px}px thickness`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setSelectedCircleThickness(px);
                        const sel = window.getSelection();
                        if (sel && !sel.isCollapsed) {
                          handleFormatText('circle', selectedCircleColor, px);
                        }
                      }}
                      className={`flex-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        selectedCircleThickness === px
                          ? 'bg-white text-stone-900'
                          : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                      }`}
                    >
                      {px}px
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <span className="w-px h-3.5 bg-stone-700 mx-0.5" />

          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              const sel = window.getSelection();
              if (!sel || sel.isCollapsed) return;

              let node = sel.anchorNode;
              let pIdx = -1;
              while (node && node !== document.body) {
                if (node instanceof HTMLElement && node.id && node.id.startsWith('inspection-paragraph-text-')) {
                  pIdx = parseInt(node.id.replace('inspection-paragraph-text-', ''), 10);
                  break;
                }
                node = node.parentNode;
              }
              if (pIdx !== -1) {
                const { start, end } = getSelectionCharacterOffsetWithin(node as HTMLElement);
                if (start !== end) {
                  setEditingNoteRange({start, end});
                } else {
                  setEditingNoteRange(null);
                }
                
                const selRange = sel.getRangeAt(0);
                const rect = selRange.getBoundingClientRect();
                const textEl = document.getElementById(`inspection-paragraph-text-${pIdx}`);
                if (textEl && rect) {
                  const textRect = textEl.getBoundingClientRect();
                  setEditingNoteOffset(Math.max(0, rect.top - textRect.top - 10));
                } else {
                  setEditingNoteOffset(0);
                }
                
                setEditingParagraphIndex(pIdx);
              }
            }}
            className="p-1.5 rounded-full hover:bg-stone-700/80 text-emerald-400 hover:text-emerald-300 transition-all cursor-pointer"
            title="Add Note to Selection"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
          </button>
        </div>
        </div>
      </div>

      <footer className="p-3.5 border-t border-stone-200 dark:border-stone-800 text-center bg-stone-50/60 dark:bg-[#121513]/60 shrink-0 flex items-center justify-between px-5 text-[12px] text-stone-500 dark:text-stone-400">
        <span>{paragraphs.length} total paragraphs</span>
        <span>{notes.length} user annotations added</span>
      </footer>
    </div>
  );
};
