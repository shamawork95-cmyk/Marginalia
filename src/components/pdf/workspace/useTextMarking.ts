/**
 * Text selection into marks: reading the selection page by page, the per-tool style handlers,
 * applying text marks, notes and reactions about a selection, and the toolbar's tool taps (moved
 * verbatim from PdfWorkspace).
 */

import React, { useEffect, useCallback } from 'react';
import { UserSettings } from '../../../types';
import {
  Annotation,
  AnnotationKind,
  BracketSide,
  DEFAULT_NOTE_SIZE,
  FractionRect,
  NoteStyle,
  DEFAULT_TEXT_SIZE,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont,
  coveredFraction,
  isTextAnchored,
  mergeRectsIntoLines,
  newAnnotationId,
  rectToFraction,
  type MaskMode
} from '../annotationModel';
import { NEUTRAL_COLORS } from '../PdfToolbar';
import { SelectionAnchor } from '../SelectionPopover';
import { isTypingTarget } from '../workspaceKeys';
import { clippedRange } from '../../../utils/selectionText';
import { commitOpenThemeField, type CreatedTheme } from '../themeField';
import { blackoutMarks, isAlreadyMarked as isAlreadyMarkedIn, planTextMarks } from '../textMarking';
import { addThemeId } from '../../../utils/markThemes';

export interface UseTextMarkingDeps {
  activeThemeId: string;
  activeThemeIds: string[];
  /** Black it out's mode: in `words` a selection made with it armed is blacked out. */
  maskMode?: MaskMode;
  annotations: Annotation[];
  pendingSelection: { page: number; rects: FractionRect[]; quote: string; }[];
  scrollRef: React.RefObject<HTMLDivElement>;
  selectedId: string;
  setAnnotations: (next: Annotation[] | ((prev: Annotation[]) => Annotation[])) => void;
  setBracketSide: React.Dispatch<React.SetStateAction<BracketSide>>;
  setNoteStyle: React.Dispatch<React.SetStateAction<NoteStyle>>;
  setOpenSubmenuFor: React.Dispatch<React.SetStateAction<string>>;
  setPendingSelection: React.Dispatch<React.SetStateAction<{ page: number; rects: FractionRect[]; quote: string; }[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string>>;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<SelectionAnchor>>;
  setTextAlign: React.Dispatch<React.SetStateAction<TextAlign>>;
  setTextBold: React.Dispatch<React.SetStateAction<boolean>>;
  setTextFont: React.Dispatch<React.SetStateAction<TextFont>>;
  setTextItalic: React.Dispatch<React.SetStateAction<boolean>>;
  setTextSize: React.Dispatch<React.SetStateAction<number>>;
  setTool: React.Dispatch<React.SetStateAction<PdfTool>>;
  setToolColor: (which: string, color: string) => void;
  setToolStrokeStyle: (which: string, style: StrokeStyle) => void;
  setToolWeight: (which: string, weight: number) => void;
  settings: UserSettings;
  startEditingId: (id: string, text: string) => void;
  submenuClosedAt: React.RefObject<{ tool: string; at: number; }>;
  tool: PdfTool;
  toolColors: Record<string, string>;
  toolWeights: Record<string, number>;
}

export function useTextMarking(deps: UseTextMarkingDeps) {
  const { maskMode, activeThemeId, activeThemeIds, annotations, pendingSelection, scrollRef, selectedId, setAnnotations, setBracketSide, setNoteStyle, setOpenSubmenuFor, setPendingSelection, setSelectedId, setSelectionAnchor, setTextAlign, setTextBold, setTextFont, setTextItalic, setTextSize, setTool, setToolColor, setToolStrokeStyle, setToolWeight, settings, startEditingId, submenuClosedAt, tool, toolColors, toolWeights } = deps;

  // ── Text selection → highlight / underline / strikeout ──
  /**
   * Reads the live text selection into per-page groups of rectangles.
   *
   * Every client rect is kept rather than one bounding box: a selection spanning several lines
   * has a ragged outline, and a single box would tint the whitespace either side of it. Rects are
   * grouped by the page element containing them, so a selection dragged across a page break makes
   * one mark on each page rather than one mark whose coordinates make sense on neither.
   */
  const readSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    /*
     * Read page by page, from each page's text layer only. `Selection.toString()` and the range's
     * own rects run between the two ends in document order, so a drag begun just left of a line,
     * over the sidebar or the toolbar, used to put their labels in the quote (and a toolbar
     * scrolled over a page could add rects). Clipping the range to each text layer keeps exactly
     * the page's words and their boxes, one mark per page for a drag across a page break.
     */
    const groups: { page: number; rects: FractionRect[]; quote: string }[] = [];
    for (const pageEl of Array.from(document.querySelectorAll<HTMLElement>('[data-page-number]'))) {
      const layer = pageEl.querySelector('.marginalia-text-layer');
      const clip = layer ? clippedRange(range, layer) : null;
      if (!clip) continue;
      const quote = clip.toString().replace(/\s+/g, ' ').trim();
      // Zero-area rects are emitted for collapsed line ends and would render as invisible slivers
      // that are impossible to click or erase.
      const rects = Array.from(clip.getClientRects()).filter((r) => r.width >= 0.5 && r.height >= 0.5);
      if (!quote || rects.length === 0) continue;
      const pageBox = pageEl.getBoundingClientRect();
      groups.push({ page: Number(pageEl.dataset.pageNumber), rects: mergeRectsIntoLines(rects).map((r) => rectToFraction(r, pageBox)), quote });
    }
    return groups.length ? groups : null;
  }, []);

  /**
   * Identifies the mark a given selection would produce, so tapping the same tool twice removes
   * the one it just made instead of stacking a duplicate on top.
   *
   * Keyed on kind, page and the covered text, plus the position of the first rectangle — the text
   * alone is not enough, because the same phrase can appear twice on a page.
   */
  const matchesSelection = useCallback(
    (a: Annotation, group: { page: number; rects: FractionRect[]; quote: string }, kind: AnnotationKind) =>
      a.kind === kind &&
      a.page === group.page &&
      a.quote === group.quote &&
      Math.abs((a.rects?.[0]?.x ?? -1) - group.rects[0].x) < 0.004 &&
      Math.abs((a.rects?.[0]?.y ?? -1) - group.rects[0].y) < 0.004,
    []
  );

  /**
   * Whether a passage already carries a mark of this kind.
   *
   * Marking the same words twice with the same tool produces two stacked marks that darken each
   * other and have to be deleted separately, which is never what anybody meant — so it is simply
   * refused. The test is per LINE and by coverage rather than by exact match, because a reader
   * re-selecting a sentence almost never reproduces their original selection to the character;
   * what they mean by "this is already highlighted" is that the words are under a highlight, not
   * that the rectangles coincide.
   *
   * Extending a mark to a genuinely longer passage still works: the new lines are uncovered, so
   * the selection as a whole does not count as already marked.
   *
   * `isTerminology` narrows the match further: Highlight and Terminology both produce
   * `kind: 'highlight'` marks, but they are independent tools reader-wise, so highlighting an
   * already-terminology-tagged passage (or vice versa) must not read as "already marked."
   */
  const isAlreadyMarked = useCallback(
    (group: { page: number; rects: FractionRect[] }, kind: AnnotationKind, isTerminology = false, themeIds: string[] = []) =>
      isAlreadyMarkedIn(annotations, group, kind, isTerminology, themeIds),
    [annotations]
  );

  /**
   * Changing a tool's colour recolours what is already marked, rather than only affecting the
   * next mark.
   *
   * Picking a new colour with something selected reads as "make this that colour" — having to
   * choose the colour and then re-apply the tool was an extra step for the obvious intent. It
   * updates the selected mark, and any mark covering the current text selection.
   */
  const handleToolColorChange = useCallback(
    (which: string, color: string) => {
      setToolColor(which, color);
      setAnnotations((prev) => {
        const selected = prev.find((a) => a.id === selectedId);
        return prev.map((a) => {
          // The mark that is picked out — but only when the chip belongs to ITS kind. Changing
          // the pen's colour while a highlight happens to be selected should not repaint the
          // highlight.
          if (a.id === selectedId && a.kind === which) return { ...a, color };
          // Siblings from the same selection: a passage crossing a page break is several marks,
          // and recolouring only one of them would look like a bug.
          if (selected?.quote && a.kind === which && selected.kind === which && a.quote === selected.quote) {
            return { ...a, color };
          }
          if (
            a.kind === which &&
            pendingSelection?.some((g) => matchesSelection(a, g, which as AnnotationKind))
          ) {
            return { ...a, color };
          }
          return a;
        });
      });
    },
    [setToolColor, selectedId, pendingSelection, matchesSelection]
  );

  /** Thickness behaves the same way: it re-strokes the selected mark straight away. */
  const handleToolWeightChange = useCallback(
    (which: string, weight: number) => {
      setToolWeight(which, weight);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === which ? { ...a, weight } : a))
      );
    },
    [setToolWeight, selectedId, setAnnotations]
  );

  /** Dash pattern, likewise: set it for the tool, and re-dash whatever is selected. */
  const handleToolStrokeStyleChange = useCallback(
    (which: string, strokeStyle: StrokeStyle) => {
      setToolStrokeStyle(which, strokeStyle);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === which ? { ...a, strokeStyle } : a))
      );
    },
    [setToolStrokeStyle, selectedId, setAnnotations]
  );

  const handleNoteStyleChange = useCallback(
    (style: NoteStyle) => {
      setNoteStyle(style);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'note' ? { ...a, noteStyle: style } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleBracketSideChange = useCallback(
    (side: BracketSide) => {
      setBracketSide(side);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'bracket' ? { ...a, bracketSide: side } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleTextSizeChange = useCallback(
    (fontSize: number) => {
      setTextSize(fontSize);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, fontSize } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleTextAlignChange = useCallback(
    (align: TextAlign) => {
      setTextAlign(align);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, align } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  /**
   * Typeface, bold and italic all behave the same way: they set what the next text box will use,
   * and restyle the selected one straight away.
   */
  const handleTextFontChange = useCallback(
    (font: TextFont) => {
      setTextFont(font);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, font } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleTextBoldChange = useCallback(
    (bold: boolean) => {
      setTextBold(bold);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, bold } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleTextItalicChange = useCallback(
    (italic: boolean) => {
      setTextItalic(italic);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, italic } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  /**
   * Applies a text mark to a selection, skipping any part of it that already carries one.
   *
   * Never toggles. Reaching for the highlighter over an already-highlighted sentence means "this
   * should be highlighted", and having that silently delete the highlight was the most alarming
   * thing the editor did. A mark is removed deliberately, from its own properties strip.
   */
  const applyTextMark = useCallback(
    (
      tool: PdfTool,
      groups: { page: number; rects: FractionRect[]; quote: string }[],
      colorOverride?: string,
      /** A theme just made in the selection menu's open "+ New theme" field (see themeField.ts). */
      themeOverride?: CreatedTheme | null
    ) => {
      // Every active theme; a theme just made in the menu's "+ New theme" field joins them.
      const themeIds = themeOverride ? addThemeId(activeThemeIds, themeOverride.id) : activeThemeIds;
      // `terminology` is a toolbar tool, not a stored kind (see PdfTool) — it produces an ordinary
      // highlight flagged `isTerminology`, coloured from the live setting rather than a tool
      // colour, so it is exempt from recolouring here even if one were ever passed.
      const isTerminology = tool === 'terminology';
      const kind: AnnotationKind = isTerminology ? 'highlight' : (tool as AnnotationKind);
      // One per page not already marked this way, or the chosen themes added to the mark already
      // on those words (textMarking.ts, tested).
      const { created: additions, tagged } = planTextMarks(annotations, groups, {
        kind,
        isTerminology,
        themeIds,
        color: isTerminology ? settings.terminologyColor : colorOverride ?? themeOverride?.color ?? toolColors[kind] ?? NEUTRAL_COLORS[0],
        weight: toolWeights[kind],
        author: settings.name
      });

      // Every page of the selection was already marked this way. Nothing to add, and nothing to
      // undo either — the reader is looking at the mark they were about to make.
      if (additions.length === 0 && tagged.length === 0) {
        setPendingSelection(null);
        return;
      }
      setAnnotations((prev) => [
        ...prev.map((a) => {
          const t = tagged.find((x) => x.id === a.id);
          return t ? { ...a, themeIds: t.themeIds, ...(t.color && { color: t.color }) } : a;
        }),
        ...additions
      ]);

      /*
        The new mark becomes the selected one.

        This is what makes changing colour afterwards work at all. Applying a mark clears the text
        selection, and the trailing mouseup then clears `pendingSelection` — so without this there
        was nothing left for a colour change to act on, and picking a colour appeared to do
        nothing. Selecting the mark also means a second toolbar tap cannot silently undo it, since
        there is no live selection left to toggle against.
      */
      setSelectedId(additions[0]?.id ?? tagged[0].id);
      setPendingSelection(null);
    },
    [annotations, toolColors, activeThemeIds, settings.name, settings.terminologyColor, toolWeights, setAnnotations]
  );

  /**
   * Remembers the selection on mouse release, and marks it straight away when a text tool is
   * already active.
   *
   * Reading on release rather than on every selection change means the mark is made once the
   * reader has finished dragging, instead of on each intermediate selection.
   */
  useEffect(() => {
    /** Reads the live selection into state; `byPointer` is false for a keyboard selection. */
    const sync = (byPointer: boolean) => {
      // Typing a new theme's name in the selection menu moves the browser's selection; the passage stays.
      if ((document.activeElement as HTMLElement | null)?.closest('[data-keep-selection]')) return;
      const groups = readSelection();
      if (!groups) {
        // A click that collapses the selection clears it, so a later tool tap does not apply to
        // something the reader has visibly moved on from.
        if (!window.getSelection()?.toString().trim()) {
          setPendingSelection(null);
          setSelectionAnchor(null);
        }
        return;
      }
      // Marking by selection always adds — never undoes. Only on release of a drag: a keyboard
      // selection grows a character at a time, and an armed tool would mark every pause in it.
      // The new mark is selected, so its properties toolbar is the one that shows; the selection
      // menu stays closed (both at once stacked a second toolbar over the passage).
      // Black it out, Words: solid bars over the selected lines.
      if (byPointer && tool === 'mask' && maskMode === 'words') {
        const bars = blackoutMarks(groups, { color: toolColors.mask ?? '#000000', author: settings.name });
        if (bars.length) {
          setAnnotations((prev) => [...prev, ...bars]);
          setSelectedId(bars[0].id);
        }
        setPendingSelection(null);
        setSelectionAnchor(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (byPointer && isTextAnchored(tool)) {
        applyTextMark(tool, groups);
        setSelectionAnchor(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
      setPendingSelection(groups);

      // Anchor the menu to the selection's own rectangle.
      const sel = window.getSelection();
      const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if (rect && rect.width + rect.height > 0) {
        setSelectionAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom });
      }
    };

    const handleUp = () => window.setTimeout(() => sync(true), 0);

    /*
      Keyboard selection (Shift+Arrow) never produces a mouseup, so the menu also follows
      `selectionchange` — debounced, so it opens once the reader pauses rather than on every
      character, and only when the last input was a key, so a drag is still read on release only.
    */
    let lastInputWasKey = false;
    let timer: number | undefined;
    const onPointerDown = () => {
      lastInputWasKey = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTypingTarget(e.target)) lastInputWasKey = true;
    };
    const onSelectionChange = () => {
      if (!lastInputWasKey) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const sel = window.getSelection();
        const node = sel?.anchorNode;
        // Only selections in the document itself, not in a field or the side panel.
        if (node && !scrollRef.current?.contains(node)) return;
        sync(false);
      }, 300);
    };

    document.addEventListener('mouseup', handleUp);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [tool, maskMode, readSelection, applyTextMark, toolColors, settings.name]);

  /**
   * Writes a sticky note about the selected passage.
   *
   * The note is placed to the RIGHT of the passage where there is usually margin, dropping below
   * it when the page is too narrow — a note laid on top of the text it discusses would hide the
   * thing it refers to. The passage itself is stored on the note so hovering can light it back up.
   */
  const createNoteForSelection = useCallback(() => {
    const groups = pendingSelection;
    if (!groups?.length) return;
    const group = groups[0];
    const bounds = {
      x: Math.min(...group.rects.map((r) => r.x)),
      y: Math.min(...group.rects.map((r) => r.y)),
      right: Math.max(...group.rects.map((r) => r.x + r.w)),
      bottom: Math.max(...group.rects.map((r) => r.y + r.h))
    };

    const { w, h } = DEFAULT_NOTE_SIZE;
    const fitsBeside = bounds.right + 0.02 + w <= 1;
    const box = {
      x: fitsBeside ? bounds.right + 0.02 : Math.min(bounds.x, 1 - w),
      y: Math.min(fitsBeside ? bounds.y : bounds.bottom + 0.015, 1 - h),
      w,
      h
    };

    const note: Annotation = {
      id: newAnnotationId(),
      page: group.page,
      kind: 'note',
      color: toolColors.note ?? NEUTRAL_COLORS[0],
      themeIds: activeThemeIds,
      box,
      anchorRects: group.rects,
      quote: group.quote,
      text: '',
      author: settings.name,
      createdAt: new Date().toISOString()
    };
    setAnnotations((prev) => [...prev, note]);
    setSelectionAnchor(null);
    window.getSelection()?.removeAllRanges();
    startEditingId(note.id, '');
  }, [pendingSelection, toolColors, activeThemeIds, settings.name]);

  /**
   * Stamps a question mark, asterisk or exclamation mark next to the start of the selected
   * passage.
   *
   * Placed like a note is — its own `box`, sized from `fontSize` — rather than tinted across every
   * line the way highlight/underline/strikeout are, since the point is a reaction to a moment in
   * the text, not a claim about which words it covers. That's also what makes it draggable,
   * resizable and recolourable afterward through the same controls a note or text box uses.
   */
  const createReactionForSelection = useCallback(
    (kind: AnnotationKind) => {
      const groups = pendingSelection;
      if (!groups?.length) return;
      const group = groups[0];
      const first = group.rects[0];
      const fontSize = DEFAULT_TEXT_SIZE;
      // A little larger than the glyph itself, for a comfortable click/drag target, and — since
      // `w` reads against PAGE WIDTH while `h` reads against the taller PAGE HEIGHT — `w` needs
      // the bigger multiplier or a "round" badge on a portrait page comes out visibly an oval.
      const h = fontSize * 1.35;
      const w = h * 1.3;
      const box = {
        x: Math.max(0, first.x - w - 0.008),
        y: Math.min(Math.max(0, first.y + first.h / 2 - h / 2), 1 - h),
        w,
        h
      };

      const reaction: Annotation = {
        id: newAnnotationId(),
        page: group.page,
        kind,
        color: toolColors[kind] ?? NEUTRAL_COLORS[0],
        themeIds: activeThemeIds,
        box,
        fontSize,
        anchorRects: group.rects,
        quote: group.quote,
        author: settings.name,
        createdAt: new Date().toISOString()
      };
      setAnnotations((prev) => [...prev, reaction]);
      setSelectedId(reaction.id);
      setSelectionAnchor(null);
      window.getSelection()?.removeAllRanges();
    },
    [pendingSelection, toolColors, activeThemeIds, settings.name]
  );

  /**
   * A tool button was tapped.
   *
   * When text is already selected and the tool is a text one, the tap acts on that selection
   * immediately — which is the "select first, then choose what to do with it" order. The tool also
   * becomes active, so the next selection is marked without a second tap.
   */
  const handleToolTap = useCallback(
    (next: PdfTool) => {
      /*
        Two orders of operation, and they mean different things.

        Selecting a passage FIRST and then reaching for a tool is a one-off action on that
        passage: mark this, and be done. So the mark is made and the workspace drops straight
        back to Select, ready for the next passage — leaving the highlighter armed would mean
        the reader's next drag silently highlighted something they only meant to read.

        Choosing the tool FIRST and then selecting is the opposite intent: the reader is settling
        in to highlight several passages in a row, and the tool stays armed until they change it.
      */
      // Black it out (Words) over a passage already selected: blacked out at once, as a highlight would be.
      if (next === 'mask' && maskMode === 'words' && pendingSelection?.length) {
        const bars = blackoutMarks(pendingSelection, { color: toolColors.mask ?? '#000000', author: settings.name });
        setAnnotations((prev) => [...prev, ...bars]);
        if (bars[0]) setSelectedId(bars[0].id);
        setPendingSelection(null);
        setSelectionAnchor(null);
        window.getSelection()?.removeAllRanges();
        setOpenSubmenuFor(null);
        return;
      }
      const actsOnSelection = isTextAnchored(next) && Boolean(pendingSelection?.length);
      if (actsOnSelection) {
        // A name typed in the menu's "+ New theme" field becomes the theme of this mark.
        applyTextMark(next, pendingSelection!, undefined, commitOpenThemeField());
        setTool('select');
        setSelectionAnchor(null);
        setOpenSubmenuFor(null);
        return;
      }

      /*
        Tapping the tool you are already holding shows and hides its options. It does NOT put the
        tool down: picking a tool both arms it and opens its colour and thickness controls, and
        the reader's next thought is usually "chosen — now get this panel out of my way".
        Disarming there would mean the gesture for dismissing a panel silently disarmed the
        highlighter mid-passage. Escape is what puts a tool down.

        The panel closes itself the moment this button is pressed, since a press outside it
        dismisses it. So closing is simply declining to ask for it back.
      */
      if (next === tool && next !== 'select') {
        const justClosed =
          submenuClosedAt.current?.tool === next &&
          performance.now() - submenuClosedAt.current.at < 350;
        // Cleared either way, so a panel dismissed by pressing the PAGE cannot swallow the next
        // tap on the tool itself.
        submenuClosedAt.current = null;
        if (justClosed) return;
        setOpenSubmenuFor(next);
        return;
      }

      setTool(next);
      // Picking up a tool opens its options with it. Colour and thickness are chosen far more
      // often at the moment of switching tools than at any other time, and requiring a second
      // click on a chip the size of a grain of rice to reach them was a tax on the common case.
      // Select, Erase and Terminology have nothing to configure — a terminology mark's colour is
      // the single setting in Settings → Terminology, not a per-tool choice.
      setOpenSubmenuFor(next === 'select' || next === 'erase' || next === 'terminology' ? null : next);
    },
    [pendingSelection, applyTextMark, tool, maskMode, toolColors, settings.name]
  );

  return { applyTextMark, createNoteForSelection, createReactionForSelection, handleBracketSideChange, handleNoteStyleChange, handleTextAlignChange, handleTextBoldChange, handleTextFontChange, handleTextItalicChange, handleTextSizeChange, handleToolColorChange, handleToolStrokeStyleChange, handleToolTap, handleToolWeightChange };
}
