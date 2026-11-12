/**
 * The reader's exports, Find in document, copy quote and linked marks, the marks archive, the excerpt
 * board's items, and arriving from a motif trace (moved verbatim from ReaderScreen).
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { hasRtlText } from '../../utils/scriptDirection';
import { paragraphHits } from '../../utils/motifTrace';
import { paintHighlight, rangeFor, readPieces } from '../findHighlight';
import { printNotesPdf } from '../../utils/documentStorage';
import nastaliqFontUrl from '@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff2?url';
import { type TextSpreadHandle } from '../TextSpread';
import { copyText, excerpt, useMarksArchive } from '../MarksArchive';
import { useDocumentFind } from '../FindBar';
import type { MarkLinks } from '../pdf/MarkProperties';
import { formatQuoteRef, markLocation } from '../../utils/quoteRef';
import { linkMarks, linkedIds, unlinkMarks } from '../../utils/markLinks';
import { ReaderJump, UserSettings } from '../../types';
import { ParagraphRange } from '../../utils/textFormatting';
import type { PlainTextAnnotations } from '../../hooks/usePlainTextAnnotations';
import { type TextMark } from '../../utils/textMarks';
import { type TextStyle } from '../../utils/pastedText';
import {
  exportToPDF,
  notesPrintHtml,
  generateMarkdown,
  generatePlainText,
  downloadTextFile,
  getFilteredAnnotations,
  textMarksForExport,
  ExportOptions
} from '../../utils/exportAnnotations';
import { PARA_TEXT_ID_PREFIX, isReactionKind, Tab } from './readerParts';
import type { Annotation } from '../pdf/annotationModel';

export interface UseReaderExtrasDeps {
  bottomInset: number;
  activeControlTab: Tab;
  annotations: PlainTextAnnotations;
  colorOf: (m: TextMark) => string;
  content: { text: string; layout?: "verbatim"; textStyles?: TextStyle[]; };
  controlBarRef: React.RefObject<HTMLDivElement>;
  displayAuthor: "";
  displayTitle: string;
  docId: string;
  editorOpen: boolean;
  heads: TextMark[];
  isDark: boolean;
  jump: ReaderJump;
  markById: Map<string, TextMark>;
  marks: TextMark[];
  onAddThemes: (themes: UserSettings["activeThemes"]) => void;
  paragraphs: string[];
  reduceMotion: boolean;
  scrollToMark: (id: string) => boolean;
  select: (ids: Iterable<string>, opts?: { additive?: boolean; }) => void;
  selectedThemeFilter: string;
  setActiveParagraphIndex: React.Dispatch<React.SetStateAction<number>>;
  settings: UserSettings;
  spreadHandle: React.RefObject<TextSpreadHandle>;
  spreadOn: boolean;
  textRef: React.RefObject<HTMLElement>;
  viewById: Map<string, Annotation>;
  views: Annotation[];
}

export function useReaderExtras(deps: UseReaderExtrasDeps) {
  const { bottomInset, activeControlTab, annotations, colorOf, content, controlBarRef, displayAuthor, displayTitle, docId, editorOpen, heads, isDark, jump, markById, marks, onAddThemes, paragraphs, reduceMotion, scrollToMark, select, selectedThemeFilter, setActiveParagraphIndex, settings, spreadHandle, spreadOn, textRef, viewById, views } = deps;

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

  return { activeJump, archive, boardItems, copyQuoteOf, copySelectionQuote, exportEntries, exportable, find, markLinksFor, runExport, setActiveJump };
}
