import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { paragraphTypeface } from '../utils/scriptDirection';
import { analysePoem } from '../utils/poetry';
import { DEFAULT_POETRY, PROSODY_THEMES } from './PoetryView';
import { type TextSpreadHandle } from './TextSpread';
import type { ThemeStore } from './themeStore';
import {
  AnnotationFocus,
  PoetryPrefs,
  ReaderJump,
  Screen,
  TransitionType,
  UserSettings
} from '../types';
import { ParagraphRange } from '../utils/textFormatting';
import type { PlainTextAnnotations } from '../hooks/usePlainTextAnnotations';
import { splitParagraphs, type TextStyle } from '../utils/pastedText';
import { fetchDocumentContent } from '../utils/documentStorage';
import { useReadingProgress } from '../hooks/useReadingProgress';
import { SelectionAnchor } from './pdf/SelectionPopover';

import {
  NAVIGATOR_HEIGHT,
  FALLBACK_COLOR,
  TextTool,
  Tab,
  TAB_INDEXES,
  EMPTY_MARKS,
  EMPTY_STYLES,
  EMPTY_NOTES,
  Paragraph
} from './reader/readerParts';
import { useReaderExtras } from './reader/useReaderExtras';
import { useReaderLayout } from './reader/useReaderLayout';
import { useReaderMarkUi } from './reader/useReaderMarkUi';
import { useReaderSelectionKeys } from './reader/useReaderSelectionKeys';
import { useReaderMarking } from './reader/useReaderMarking';
import { useReaderMarkViews } from './reader/useReaderMarkViews';
import { ReaderNoteEditor } from './reader/ReaderNoteEditor';
import { ReaderPopovers } from './reader/ReaderPopovers';
import { ReaderBody } from './reader/ReaderBody';
import { ReaderControlBar } from './reader/ReaderControlBar';
import { ReaderHeader } from './reader/ReaderHeader';
import { useKnownThemes } from '../hooks/knownTheme';
import { toggleThemeId } from '../utils/markThemes';

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
  const [activeThemeIds, setActiveThemeIds] = useState<string[]>(() => (settings.activeThemes[0] ? [settings.activeThemes[0].id] : []));
  const activeThemeId = activeThemeIds[0] ?? null;
  const setActiveThemeId = useCallback((id: string | null) => setActiveThemeIds(id ? [id] : []), []);
  /** The selection menu's dots and the number keys over a selection toggle several themes. */
  const toggleActiveTheme = useCallback((id: string) => setActiveThemeIds((prev) => toggleThemeId(prev, id)), []);
  // Never a theme that is not in the list (see knownTheme.ts).
  useKnownThemes(activeThemeIds, setActiveThemeIds, settings.activeThemes);
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
    themeIds: string[];
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
  const { colorOf, editing, editorColor, editorIsNote, editorOpen, editorPara, heads, hovByPara, markById, noteHeads, paraData, selByPara, selectedView, viewById, views } = useReaderMarkViews({ editingId, hoveredId, marks, newNote, paragraphs, selectedIds, settings });
  const { applyMark, clock, closeEditor, createNoteForSelection, createParagraphNote, createReactionForSelection, deleteMark, dropSelection, editorRef, handleToolTap, saveEditing, startEditing } = useReaderMarking({ activeColor, activeThemeId, activeThemeIds, addMarks, deleteMarks, draftQuote, draftText, draftTitle, editingId, editorOpen, editorPara, markById, marks, newNote, paragraphs, pendingSelection, select, setDraftQuote, setDraftText, setDraftTitle, setEditingId, setNewNote, setPendingSelection, setSelectionAnchor, setTool, settings, textRef, updateMarks, viewById });
  useReaderSelectionKeys({ applyMark, clearSelection, createNoteForSelection, deleteMarks, dropSelection, editorOpen, handleToolTap, marks, pendingSelection, redo, selectedIds, selectionAnchor, setActiveThemeId, toggleActiveTheme, setPendingSelection, setSelectionAnchor, setTool, settings, textRef, tool, undo, updateMarks });
  // The two-page spread's handle: made here, ahead of the hooks that turn its pages.
  const spreadHandle = useRef<TextSpreadHandle>(null);
  const { markRect, paragraphActions, scrollToMark, scrollToMarkRef } = useReaderMarkUi({ spreadHandle, activeControlTab, createParagraphNote, deleteMark, handleSwitchTab, isPanelOpen, marks, reduceMotion, select, selectedIds, selectionAnchor, setActiveParagraphIndex, setHoveredId, setOpenPin, setSelectionAnchor, showInlineNotes, startEditing, textRef });
  const { bodyRef, marginMode, paragraphFont, placementContext, setFlow, spreadFits, spreadOn, spreadPref, spreadStartId, toggleSpread } = useReaderLayout({ spreadHandle, activeControlTab, controlBarRef, docId, isPanelOpen, marks, onSpreadChange, openPin, paraData, paragraphs, poem, poetry, reportProgress, setOpenPin, settings, showInlineNotes });
  // Declared here, before the hooks that read it (Find's reveal used it from below).
  const bottomInset = activeFocus ? NAVIGATOR_HEIGHT : 0;
  const { activeJump, archive, boardItems, copyQuoteOf, copySelectionQuote, exportEntries, exportable, find, markLinksFor, runExport, setActiveJump } = useReaderExtras({ bottomInset, activeControlTab, annotations, colorOf, content, controlBarRef, displayAuthor, displayTitle, docId, editorOpen, heads, isDark, jump, markById, marks, onAddThemes, paragraphs, reduceMotion, scrollToMark, select, selectedThemeFilter, setActiveParagraphIndex, settings, spreadHandle, spreadOn, textRef, viewById, views });

  // Popovers stay below the sticky header and control bar.
  // In focus mode the bar slides over the page when called, so menus keep clear of where it lands.
  const popoverTopInset = focusMode
    ? (controlBarRef.current?.offsetHeight ?? 0)
    : (controlBarRef.current?.getBoundingClientRect().bottom ?? headerRef.current?.getBoundingClientRect().bottom ?? 0);
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
        themes={settings.activeThemes}
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
      <ReaderHeader activeThemeId={activeThemeId} displayTitle={displayTitle} focusMode={focusMode} headerRef={headerRef} isDark={isDark} onNavigate={onNavigate} setActiveThemeId={setActiveThemeId} settings={settings} themeStripRef={themeStripRef} />

      <ReaderControlBar activeColor={activeColor} activeControlTab={activeControlTab} activeJump={activeJump} activeParagraphIndex={activeParagraphIndex} addProsodyThemes={addProsodyThemes} canRedo={canRedo} canUndo={canUndo} controlBarRef={controlBarRef} createParagraphNote={createParagraphNote} docId={docId} find={find} focusMode={focusMode} handleSwitchTab={handleSwitchTab} handleToolTap={handleToolTap} iconBtn={iconBtn} isDark={isDark} isPanelOpen={isPanelOpen} missingProsody={missingProsody} noteHeads={noteHeads} onToggleFocus={onToggleFocus} pendingSelection={pendingSelection} pillClass={pillClass} poem={poem} poetry={poetry} poetryOpen={poetryOpen} redo={redo} selectedIds={selectedIds} setActiveJump={setActiveJump} setIsPanelOpen={setIsPanelOpen} setPoetry={setPoetry} setPoetryOpen={setPoetryOpen} setShowInlineNotes={setShowInlineNotes} settings={settings} showInlineNotes={showInlineNotes} spreadFits={spreadFits} spreadOn={spreadOn} spreadPref={spreadPref} themeStore={themeStore} toggleSpread={toggleSpread} tool={tool} undo={undo} views={views} />

      <ReaderBody activeControlTab={activeControlTab} annotations={annotations} archive={archive} boardItems={boardItems} bodyRef={bodyRef} clearSelection={clearSelection} deleteMark={deleteMark} displayTitle={displayTitle} exportEntries={exportEntries} exportable={exportable} handleSwitchTab={handleSwitchTab} hoveredId={hoveredId} iconBtn={iconBtn} isDark={isDark} isPanelOpen={isPanelOpen} marginMode={marginMode} marks={marks} paragraphNodes={paragraphNodes} poetry={poetry} reduceMotion={reduceMotion} runExport={runExport} scrollToMark={scrollToMark} scrollToMarkRef={scrollToMarkRef} select={select} selectedThemeFilter={selectedThemeFilter} setFlow={setFlow} setHoveredId={setHoveredId} setIsPanelOpen={setIsPanelOpen} setSelectedThemeFilter={setSelectedThemeFilter} setSelectionAnchor={setSelectionAnchor} settings={settings} slideDirection={slideDirection} spreadHandle={spreadHandle} spreadOn={spreadOn} spreadStartId={spreadStartId} startEditing={startEditing} textRef={textRef} titleBlock={titleBlock} updateMarks={updateMarks} views={views} />

      <ReaderPopovers activeControlTab={activeControlTab} activeFocus={activeFocus} activeThemeId={activeThemeId} activeThemeIds={activeThemeIds} toggleActiveTheme={toggleActiveTheme} annotations={annotations} applyMark={applyMark} archive={archive} bottomInset={bottomInset} clearSelection={clearSelection} copyQuoteOf={copyQuoteOf} copySelectionQuote={copySelectionQuote} createNoteForSelection={createNoteForSelection} createReactionForSelection={createReactionForSelection} deleteMark={deleteMark} dropSelection={dropSelection} editorOpen={editorOpen} isDark={isDark} markLinksFor={markLinksFor} markRect={markRect} pendingSelection={pendingSelection} placementContext={placementContext} popoverTopInset={popoverTopInset} scrollToMark={scrollToMark} selectedView={selectedView} selectionAnchor={selectionAnchor} selectionInView={selectionInView} setActiveFocus={setActiveFocus} setActiveThemeId={setActiveThemeId} setHoveredId={setHoveredId} setSelectionAnchor={setSelectionAnchor} setTool={setTool} settings={settings} startEditing={startEditing} themeStore={themeStore} toolColors={toolColors} updateMarks={updateMarks} views={views} />

      <ReaderNoteEditor closeEditor={closeEditor} deleteMark={deleteMark} draftQuote={draftQuote} draftText={draftText} draftTitle={draftTitle} editing={editing} editorColor={editorColor} editorIsNote={editorIsNote} editorOpen={editorOpen} editorPara={editorPara} editorRef={editorRef} isDark={isDark} newNote={newNote} saveEditing={saveEditing} setDraftQuote={setDraftQuote} setDraftText={setDraftText} setDraftTitle={setDraftTitle} viewById={viewById} />
    </div>
  );
};
