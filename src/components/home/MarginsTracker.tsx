/**
 * My Margins Tracker on My Collections: the overview, themes and terminology tabs, gathering marks
 * from every book (moved verbatim from HomeScreen).
 */

import React from 'react';
import { Lightbulb, Tag, ChevronDown, Compass, MotifPath } from '../icons';
import { motion, AnimatePresence } from 'motion/react';
import { AnnotationFocus, UserSettings } from '../../types';
import { StoredDocumentMeta } from '../../utils/documentStorage';
import { plural } from '../../utils/plural';
import { TAB_IN_FORWARD, TAB_IN_BACK, MarkPeekRow } from './homeParts';

export interface MarginsTrackerProps {
  booksByTheme: Map<string, StoredDocumentMeta[]>;
  documentsWithTerminology: StoredDocumentMeta[];
  goToStudioTab: (next: "overview" | "themes" | "terminology") => void;
  goToThemeSettings: () => void;
  isDark: boolean;
  isStudioCollapsed: boolean;
  keyConceptMarks: number;
  keyConceptsBooks: StoredDocumentMeta[];
  keyConceptsTheme: { id: string; name: string; color: string; };
  onOpenMotifTracer: () => void;
  onOpenStoredDocument: (meta: StoredDocumentMeta, focus?: AnnotationFocus) => void;
  settings: UserSettings;
  studioDirection: 1 | -1;
  studioTab: "overview" | "themes" | "terminology";
  terminologyMarks: number;
  themesAreUntouched: boolean;
  toggleStudioCollapsed: () => void;
  totalMarks: number;
}

export const MarginsTracker: React.FC<MarginsTrackerProps> = ({ booksByTheme, documentsWithTerminology, goToStudioTab, goToThemeSettings, isDark, isStudioCollapsed, keyConceptMarks, keyConceptsBooks, keyConceptsTheme, onOpenMotifTracer, onOpenStoredDocument, settings, studioDirection, studioTab, terminologyMarks, themesAreUntouched, toggleStudioCollapsed, totalMarks }) => (
  <>
      {/* ── MY MARGINS TRACKER ────────────── */}
      <section
        className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
          isDark ? 'bg-night-3 border-stone-800/90' : 'bg-[#fcfbf9] border-stone-200/90'
        }`}
      >
        {/* Studio Top Control Strip */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b ${
            isDark ? 'border-stone-800/80 bg-night-4' : 'border-stone-200/70 bg-[#f7f5f0]'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gold/10 dark:bg-gold/15 flex items-center justify-center text-gold">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="title-hand text-[26px] text-stone-900 dark:text-stone-100 leading-none">
                  My Margins Tracker
                </h2>
                <span className="font-spine text-[10.5px] px-1.5 py-0.2 rounded bg-stone-500/10 text-stone-600 dark:text-stone-400">
                  {plural(totalMarks, 'mark')}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {onOpenMotifTracer && (
              <button
                type="button"
                onClick={onOpenMotifTracer}
                title="Follow an image or idea across every document"
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full border caps caps-sm text-[11.5px] cursor-pointer transition-colors ${
                  isDark ? 'border-stone-800 bg-night-2 text-stone-300 hover:border-gold' : 'border-stone-200 bg-white text-stone-700 hover:border-gold'
                }`}
              >
                <MotifPath className="w-3.5 h-3.5 text-gold" />
                Trace a motif
              </button>
            )}
            {!isStudioCollapsed && (
              <div
                role="tablist"
                aria-label="My Margins Tracker views"
                // Arrow keys move between tabs, which is what `role="tablist"` promises a screen
                // reader and a keyboard user. Without it the role was a claim the widget did not
                // honour, which is worse than no role at all.
                onKeyDown={(e) => {
                  const order = ['overview', 'themes', 'terminology'] as const;
                  const at = order.indexOf(studioTab);
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const next = (at + (e.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length;
                    goToStudioTab(order[next]);
                    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
                  }
                }}
                className={`flex items-center p-0.5 rounded-full border text-[11.5px] font-medium ${
                  isDark ? 'bg-night-2 border-stone-800' : 'bg-white border-stone-200'
                }`}
              >
                {(
                  [
                    { id: 'overview', label: 'Overview' },
                    { id: 'themes', label: 'Themes' },
                    { id: 'terminology', label: 'Terminologies' }
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    id={`studio-tab-${tab.id}`}
                    aria-selected={studioTab === tab.id}
                    aria-controls="knowledge-studio-body"
                    // Roving tabindex: the strip is one stop, and the arrow keys move within it.
                    tabIndex={studioTab === tab.id ? 0 : -1}
                    onClick={() => goToStudioTab(tab.id)}
                    className={`px-2.5 py-1 rounded-full caps caps-sm transition-all cursor-pointer ${
                      studioTab === tab.id
                        ? 'bg-accent text-on-accent shadow-2xs font-semibold'
                        : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={toggleStudioCollapsed}
              title={isStudioCollapsed ? 'Expand My Margins Tracker' : 'Collapse My Margins Tracker'}
              aria-label={isStudioCollapsed ? 'Expand My Margins Tracker' : 'Collapse My Margins Tracker'}
              aria-expanded={!isStudioCollapsed}
              aria-controls="knowledge-studio-body"
              className={`p-1.5 rounded-full border transition-colors cursor-pointer ${
                isDark
                  ? 'border-stone-800 text-stone-400 hover:bg-stone-800'
                  : 'border-stone-200 text-muted hover:bg-stone-100'
              }`}
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  isStudioCollapsed ? '-rotate-90' : 'rotate-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Studio Content Body */}
        <AnimatePresence initial={false}>
          {!isStudioCollapsed && (
            <motion.div
              id="knowledge-studio-body"
              role="tabpanel"
              aria-labelledby={`studio-tab-${studioTab}`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className="p-5">
                {/* ── BENTO OVERVIEW MODE ── */}
                {studioTab === 'overview' && (
                  <div
                    key={studioTab}
                    className={`${studioDirection === 1 ? TAB_IN_FORWARD : TAB_IN_BACK} grid md:grid-cols-2 grid-cols-1 gap-4`}
                  >
                    {/* Bento Card 1: Thematic Atlas */}
                    <div
                      className={`flex flex-col rounded-xl border p-4.5 ${
                        isDark ? 'bg-night-4/70 border-stone-800' : 'bg-white border-stone-200/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: keyConceptsTheme?.color || '#3b82f6' }}
                          />
                          <h3 className="title-hand text-[21px] text-stone-900 dark:text-stone-100">
                            Thematic Atlas
                          </h3>
                        </div>
                        <span className="font-spine text-[11px] text-muted tabular-nums">
                          {plural(keyConceptMarks, 'mark')}
                        </span>
                      </div>

                      <p className="text-[12px] text-muted leading-relaxed mb-3">
                        Key Concepts and color-coded topics tagged across My Collections.
                      </p>

                      {/* Theme List / Chips */}
                      <div className="flex-1 flex flex-col gap-1.5 min-h-27.5">
                        {keyConceptsBooks.length > 0 ? (
                          <div className="space-y-1">
                            <span className="text-[10.5px] uppercase tracking-wider font-spine font-medium text-muted">
                              Top Concept Volumes
                            </span>
                            {keyConceptsBooks.slice(0, 3).map((doc) => {
                              const conceptMarks = doc.themeCounts?.[keyConceptsTheme!.id] ?? 0;
                              return (
                                <button
                                  key={doc.id}
                                  type="button"
                                  onClick={() =>
                                    onOpenStoredDocument?.(doc, {
                                      kind: 'theme',
                                      themeId: keyConceptsTheme!.id,
                                      label: keyConceptsTheme!.name,
                                      color: keyConceptsTheme!.color
                                    })
                                  }
                                  className={`w-full flex items-center justify-between py-1.5 px-2 rounded-md text-left transition-colors cursor-pointer group ${
                                    isDark ? 'hover:bg-white/5' : 'hover:bg-stone-100'
                                  }`}
                                >
                                  <span className="font-serif text-[13px] text-stone-700 dark:text-stone-200 truncate group-hover:text-gold">
                                    {doc.title}
                                  </span>
                                  {/* This book's Key Concepts marks — the number this card is
                                      about. It used to also show how many DIFFERENT themes the
                                      book carried, which says nothing about key concepts and
                                      read as a wrong count sitting next to a right one. */}
                                  <span className="font-spine text-[11px] tabular-nums shrink-0 ml-2 text-muted">
                                    {plural(conceptMarks, 'mark')}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col justify-center items-center text-center p-3 rounded-lg bg-stone-500/5">
                            <Lightbulb className="w-5 h-5 text-stone-400 mb-1" />
                            <span className="text-[11.5px] text-muted">No key concepts tagged yet</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 pt-3 border-t border-stone-200/60 dark:border-stone-800/80 flex items-center justify-between text-[11.5px]">
                        <button
                          type="button"
                          onClick={() => goToStudioTab('themes')}
                          className="font-semibold text-gold hover:underline cursor-pointer"
                        >
                          View all {plural(settings.activeThemes.length, 'theme')} →
                        </button>
                        {themesAreUntouched && (
                          <button
                            type="button"
                            onClick={goToThemeSettings}
                            className="text-muted hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                          >
                            Customise
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bento Card 2: Terminologies */}
                    <div
                      className={`flex flex-col rounded-xl border p-4.5 ${
                        isDark ? 'bg-night-4/70 border-stone-800' : 'bg-white border-stone-200/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: settings.terminologyColor || '#ec4899' }}
                          />
                          <h3 className="title-hand text-[21px] text-stone-900 dark:text-stone-100">
                            Terminologies
                          </h3>
                        </div>
                        <span className="font-spine text-[11px] text-muted tabular-nums">
                          {plural(terminologyMarks, 'mark')}
                        </span>
                      </div>

                      <p className="text-[12px] text-muted leading-relaxed mb-3">
                        Specialized vocabularies and terminology defined while annotating passages.
                      </p>

                      <div className="flex-1 flex flex-col gap-1.5 min-h-27.5">
                        {documentsWithTerminology.length > 0 ? (
                          <div className="space-y-1">
                            <span className="text-[10.5px] uppercase tracking-wider font-spine font-medium text-muted">
                              Books with terms
                            </span>
                            {documentsWithTerminology.slice(0, 3).map((doc) => (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() =>
                                  onOpenStoredDocument?.(doc, {
                                    kind: 'terminology',
                                    label: 'Terminology',
                                    color: settings.terminologyColor
                                  })
                                }
                                className={`w-full flex items-center justify-between py-1 px-2 rounded-md text-left transition-colors cursor-pointer group ${
                                  isDark ? 'hover:bg-white/5' : 'hover:bg-stone-100'
                                }`}
                              >
                                <span className="font-serif text-[13px] text-stone-700 dark:text-stone-200 truncate group-hover:text-gold">
                                  {doc.title}
                                </span>
                                <span className="font-spine text-[11px] text-muted tabular-nums shrink-0 ml-2">
                                  {plural(doc.terminologyCount, 'mark')}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col justify-center items-center text-center p-3 rounded-lg bg-stone-500/5">
                            <Tag className="w-5 h-5 text-stone-400 mb-1" />
                            <span className="text-[11.5px] text-muted">No terms defined yet</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 pt-3 border-t border-stone-200/60 dark:border-stone-800/80 flex items-center justify-between text-[11.5px]">
                        <button
                          type="button"
                          onClick={() => goToStudioTab('terminology')}
                          className="font-semibold text-gold hover:underline cursor-pointer"
                        >
                          All terminology marks ({terminologyMarks}) →
                        </button>
                      </div>
                    </div>

                  </div>
                )}

                {/* ── THEMES EXPANDED VIEW ── */}
                {studioTab === 'themes' && (
                  <div
                    key={studioTab}
                    className={`${studioDirection === 1 ? TAB_IN_FORWARD : TAB_IN_BACK} space-y-4`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="title-hand text-[22px] text-stone-900 dark:text-stone-100">
                        All Active Themes & Key Concepts
                      </h3>
                      <button
                        type="button"
                        onClick={goToThemeSettings}
                        className="text-[12px] font-semibold text-gold hover:underline cursor-pointer"
                      >
                        Manage Theme Colors
                      </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                      {settings.activeThemes.map((theme) => {
                        const books = booksByTheme.get(theme.id) ?? [];
                        const totalMarksForTheme = books.reduce(
                          (sum, b) => sum + (b.themeCounts?.[theme.id] ?? 0),
                          0
                        );
                        return (
                          <div
                            key={theme.id}
                            className={`p-3.5 rounded-xl border ${
                              isDark ? 'bg-night-4/60 border-stone-800' : 'bg-white border-stone-200/80'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className="w-3 h-3 rounded-full shrink-0"
                                  style={{ backgroundColor: theme.color }}
                                />
                                <strong className="font-serif text-[13.5px] font-semibold text-stone-900 dark:text-stone-100">
                                  {theme.name}
                                </strong>
                              </span>
                              <span className="font-spine text-[11px] text-muted tabular-nums">
                                {plural(totalMarksForTheme, 'mark')}
                              </span>
                            </div>

                            {books.length > 0 ? (
                              <ul className="divide-y divide-stone-100 dark:divide-stone-800/60 mt-2">
                                {books.map((doc) => (
                                  <MarkPeekRow
                                    key={doc.id}
                                    docId={doc.id}
                                    title={doc.title}
                                    // Marks under THIS theme. A book's total theme count belongs
                                    // to the book, not to the theme card it is listed inside.
                                    count={doc.themeCounts?.[theme.id] ?? 0}
                                    themeId={theme.id}
                                    onOpen={() =>
                                      onOpenStoredDocument?.(doc, {
                                        kind: 'theme',
                                        themeId: theme.id,
                                        label: theme.name,
                                        color: theme.color
                                      })
                                    }
                                  />
                                ))}
                              </ul>
                            ) : (
                              <p className="text-[11.5px] text-muted italic mt-1">
                                No books marked with this theme yet.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── LEXICON EXPANDED VIEW ── */}
                {studioTab === 'terminology' && (
                  <div
                    key={studioTab}
                    className={`${studioDirection === 1 ? TAB_IN_FORWARD : TAB_IN_BACK} space-y-4`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="title-hand text-[22px] text-stone-900 dark:text-stone-100">
                        Terminologies Across My Collections
                      </h3>
                      <span className="font-spine text-[12px] text-muted tabular-nums">
                        {plural(terminologyMarks, 'mark')} in {plural(documentsWithTerminology.length, 'book')}
                      </span>
                    </div>

                    {documentsWithTerminology.length === 0 ? (
                      <div className="py-8 text-center text-muted text-[13px]">
                        No terminology marks captured yet. Select a word in any book and tag it as Terminology.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {documentsWithTerminology.map((doc) => (
                          <div
                            key={doc.id}
                            className={`p-3.5 rounded-xl border ${
                              isDark ? 'bg-night-4/60 border-stone-800' : 'bg-white border-stone-200/80'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Tag className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                              <span className="text-[11px] font-semibold tracking-wider uppercase text-muted">
                                Terminology
                              </span>
                            </div>
                            {/* The same expanding row as the theme cards: the caret shows the
                                terms themselves rather than only how many there are. */}
                            <ul>
                              <MarkPeekRow
                                docId={doc.id}
                                title={doc.title}
                                count={doc.terminologyCount}
                                themeId={null}
                                onOpen={() =>
                                  onOpenStoredDocument?.(doc, {
                                    kind: 'terminology',
                                    label: 'Terminology',
                                    color: settings.terminologyColor
                                  })
                                }
                              />
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
  </>
);
