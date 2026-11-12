/**
 * The reader's body: the text column (reading, excerpt board or export tab) and the marks panel beside
 * it (moved verbatim from ReaderScreen).
 */

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, X, Download, Board as BoardIcon } from '../icons';
import { ExcerptBoard } from '../ExcerptBoard';
import { TextSpread, type TextSpreadHandle } from '../TextSpread';
import { ArchivePanel, archiveRows } from '../MarksArchive';
import { linkMarks } from '../../utils/markLinks';
import { PoetryPrefs, UserSettings } from '../../types';
import type { PlainTextAnnotations } from '../../hooks/usePlainTextAnnotations';
import { type TextMark } from '../../utils/textMarks';
import { SelectionAnchor } from '../pdf/SelectionPopover';
import { NotesList } from '../pdf/NotesList';
import { ExportOptions } from '../../utils/exportAnnotations';
import { plural } from '../../utils/plural';
import { Tab, tabVariants, MarginMode, MARGIN_CARDS_PX, MARGIN_PINS_PX } from './readerParts';
import type { MarksArchive } from '../MarksArchive';
import type { ExportEntry } from '../../utils/exportAnnotations';
import type { Annotation } from '../pdf/annotationModel';
import type { TextMarkPatch } from '../../utils/textMarks';

export interface ReaderBodyProps {
  activeControlTab: Tab;
  annotations: PlainTextAnnotations;
  archive: MarksArchive;
  boardItems: { mark: TextMark; quote: string; color: string; }[];
  bodyRef: React.RefObject<HTMLDivElement>;
  clearSelection: () => void;
  deleteMark: (id: string) => void;
  displayTitle: string;
  exportEntries: ExportEntry[];
  exportable: ExportEntry[];
  handleSwitchTab: (newTab: Tab) => void;
  hoveredId: string;
  iconBtn: "p-2 rounded-lg text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-stone-800 dark:hover:text-stone-200 disabled:opacity-30 cursor-pointer disabled:cursor-default shrink-0";
  isDark: boolean;
  isPanelOpen: boolean;
  marginMode: MarginMode;
  marks: TextMark[];
  paragraphNodes: React.JSX.Element[];
  poetry: PoetryPrefs;
  reduceMotion: boolean;
  runExport: (format: ExportOptions["format"]) => void;
  scrollToMark: (id: string) => boolean;
  scrollToMarkRef: React.RefObject<(id: string) => boolean>;
  select: (ids: Iterable<string>, opts?: { additive?: boolean; }) => void;
  selectedThemeFilter: string;
  setFlow: React.Dispatch<React.SetStateAction<HTMLDivElement>>;
  setHoveredId: React.Dispatch<React.SetStateAction<string>>;
  setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedThemeFilter: React.Dispatch<React.SetStateAction<string>>;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<SelectionAnchor>>;
  settings: UserSettings;
  slideDirection: number;
  spreadHandle: React.RefObject<TextSpreadHandle>;
  spreadOn: boolean;
  spreadStartId: React.RefObject<string>;
  startEditing: (id: string) => void;
  textRef: React.RefObject<HTMLElement>;
  titleBlock: React.JSX.Element;
  updateMarks: (ids: Iterable<string>, patch: TextMarkPatch) => void;
  views: Annotation[];
}

export const ReaderBody: React.FC<ReaderBodyProps> = ({ activeControlTab, annotations, archive, boardItems, bodyRef, clearSelection, deleteMark, displayTitle, exportEntries, exportable, handleSwitchTab, hoveredId, iconBtn, isDark, isPanelOpen, marginMode, marks, paragraphNodes, poetry, reduceMotion, runExport, scrollToMark, scrollToMarkRef, select, selectedThemeFilter, setFlow, setHoveredId, setIsPanelOpen, setSelectedThemeFilter, setSelectionAnchor, settings, slideDirection, spreadHandle, spreadOn, spreadStartId, startEditing, textRef, titleBlock, updateMarks, views }) => (
  <>
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
  </>
);
