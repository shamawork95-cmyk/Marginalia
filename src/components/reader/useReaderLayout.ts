/**
 * The reader's layout: reading progress, the body's width, the two-page spread and its way back, the
 * margin (cards or pins) and its note placement, where popovers may sit, the poem overlay and the
 * paragraph font (moved verbatim from ReaderScreen).
 */

import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { usePoemOverlay } from '../PoetryView';
import { MIN_SPREAD_WIDTH, type TextSpreadHandle } from '../TextSpread';
import { PoetryPrefs, UserSettings } from '../../types';
import { type TextMark } from '../../utils/textMarks';
import { stackMargin } from '../marginLayout';
import type { PanelContext } from '../pdf/useAnchoredPanel';
import {
  PARA_TEXT_ID_PREFIX,
  Tab,
  NoteItem,
  MarginMode,
  MARGIN_CARDS_PX,
  MIN_TEXT_PX
} from './readerParts';
import type { PoemAnalysis } from '../../utils/poetry';

export interface UseReaderLayoutDeps {
  /** Created by ReaderScreen, ahead of the hooks that use it. */
  spreadHandle: React.RefObject<TextSpreadHandle | null>;
  activeControlTab: Tab;
  controlBarRef: React.RefObject<HTMLDivElement>;
  docId: string;
  isPanelOpen: boolean;
  marks: TextMark[];
  onSpreadChange: (on: boolean) => void;
  openPin: string;
  paraData: { glyphs: Map<number, string>; marks: Map<number, TextMark[]>; notes: Map<number, NoteItem[]>; };
  paragraphs: string[];
  poem: PoemAnalysis;
  poetry: PoetryPrefs;
  reportProgress: (position: number, total: number) => void;
  setOpenPin: React.Dispatch<React.SetStateAction<string>>;
  settings: UserSettings;
  showInlineNotes: boolean;
}

export function useReaderLayout(deps: UseReaderLayoutDeps) {
  const { spreadHandle, activeControlTab, controlBarRef, docId, isPanelOpen, marks, onSpreadChange, openPin, paraData, paragraphs, poem, poetry, reportProgress, setOpenPin, settings, showInlineNotes } = deps;
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

  return { bodyRef, marginMode, paragraphFont, placementContext, setFlow, spreadFits, spreadOn, spreadPref, spreadStartId, toggleSpread };
}
