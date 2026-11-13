/**
 * My Readings on My Collections: search, format filter, sort, shelf or list view, and the bookshelf
 * itself (moved verbatim from HomeScreen).
 */

import React from 'react';
import {
  Upload,
  ArrowRight,
  FileText,
  Search,
  Trash2,
  Loader2,
  Books,
  List,
  ArrowUpDown,
  BookMarked
} from '../icons';
import { AnnotationFocus, Screen, TransitionType, UserSettings } from '../../types';
import { Bookshelf, progressLabel } from '../Bookshelf';
import { StoredDocumentMeta } from '../../utils/documentStorage';

export interface ReadingsShelfProps {
  busyId: string;
  commitDelete: (id: string) => Promise<boolean>;
  commitRename: (id: string, title: string) => Promise<void>;
  confirmingDeleteId: string;
  formatFilter: "all" | "pdf" | "epub" | "docx" | "txt";
  isDark: boolean;
  isLoadingLibrary: boolean;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  onOpenStoredDocument: (meta: StoredDocumentMeta, focus?: AnnotationFocus) => void;
  query: string;
  searchInputRef: React.RefObject<HTMLInputElement>;
  setConfirmingDeleteId: React.Dispatch<React.SetStateAction<string>>;
  setFormatFilter: React.Dispatch<React.SetStateAction<"all" | "pdf" | "epub" | "docx" | "txt">>;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  setSortOrder: React.Dispatch<React.SetStateAction<"recent" | "title" | "marks" | "words">>;
  setViewMode: React.Dispatch<React.SetStateAction<"grid" | "list">>;
  settings: UserSettings;
  sortOrder: "recent" | "title" | "marks" | "words";
  stored: StoredDocumentMeta[];
  viewMode: "grid" | "list";
  visible: StoredDocumentMeta[];
}

export const ReadingsShelf: React.FC<ReadingsShelfProps> = ({ busyId, commitDelete, commitRename, confirmingDeleteId, formatFilter, isDark, isLoadingLibrary, onNavigate, onOpenStoredDocument, query, searchInputRef, setConfirmingDeleteId, setFormatFilter, setQuery, setSortOrder, setViewMode, settings, sortOrder, stored, viewMode, visible }) => (
  <>
      {/* ── THE BOOKSHELF ("MY READINGS") ────────────────────────────────── */}
      <section id="shelf-section" className="mb-10 space-y-5">
        {/* Shelf Control Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="title-hand text-[32px] text-stone-900 dark:text-stone-100">
              My Readings
            </h2>
            <span className="font-spine text-[12px] text-muted tabular-nums">
              ({visible.length})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Bar with '/' shortcut indicator */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search my readings…"
                aria-label="Filter documents"
                className={`w-44 md:w-56 pl-8.5 pr-8 py-1.5 rounded-xl border text-[12.5px] transition-all focus:outline-none focus:ring-1 focus:ring-gold ${
                  isDark
                    ? 'bg-night-4 border-stone-800 text-stone-100 placeholder-stone-600'
                    : 'bg-white border-stone-200 text-stone-900 placeholder-stone-400'
                }`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none font-spine text-[10px] text-muted border border-stone-300 dark:border-stone-700 px-1 rounded">
                /
              </span>
            </div>

            {/* Format Filter Chips */}
            <div
              className={`hidden sm:flex items-center p-0.5 rounded-full border text-[11px] font-medium ${
                isDark ? 'bg-night-4 border-stone-800' : 'bg-white border-stone-200'
              }`}
            >
              {(['all', 'pdf', 'epub', 'docx', 'txt'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormatFilter(fmt)}
                  className={`px-2.5 py-1 rounded-full caps caps-sm transition-all cursor-pointer ${
                    formatFilter === fmt
                      ? 'bg-accent text-on-accent font-semibold'
                      : 'text-muted hover:text-stone-900 dark:hover:text-stone-200'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            {/* Sort Selector */}
            <div
              className={`flex items-center rounded-xl border px-2 py-1 gap-1 text-[12px] ${
                isDark ? 'bg-night-4 border-stone-800 text-stone-300' : 'bg-white border-stone-200 text-stone-700'
              }`}
            >
              <ArrowUpDown className="w-3 h-3 text-stone-400" />
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as any)}
                aria-label="Sort documents"
                className="bg-transparent border-none text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-gold rounded-sm cursor-pointer"
              >
                <option value="recent">Recent</option>
                <option value="title">Title</option>
                <option value="marks">Marks</option>
                <option value="words">Word Count</option>
              </select>
            </div>

            {/* View Mode Toggle (Grid / List) */}
            <div
              className={`flex items-center p-0.5 rounded-full border ${
                isDark ? 'bg-night-4 border-stone-800' : 'bg-white border-stone-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Shelf view"
                aria-label="Shelf view"
                aria-pressed={viewMode === 'grid'}
                className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-accent text-on-accent'
                    : 'text-muted hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                <Books className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                title="Bibliography list view"
                aria-label="Bibliography list view"
                aria-pressed={viewMode === 'list'}
                className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-accent text-on-accent'
                    : 'text-muted hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Shelf Content */}
        {isLoadingLibrary && stored.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
            <p className="font-spine text-[12px] text-muted">Reading your local shelf…</p>
          </div>
        ) : stored.length === 0 ? (
          <button
            type="button"
            onClick={() => onNavigate('upload', 'push')}
            className={`w-full rounded-2xl border-2 border-dashed py-20 px-6 flex flex-col items-center gap-4 text-center transition-all cursor-pointer ${
              isDark
                ? 'border-stone-800 hover:border-stone-700 bg-night-4/30'
                : 'border-stone-300 hover:border-stone-400 bg-stone-50/50'
            }`}
          >
            <div className="w-14 h-14 rounded-2xl bg-accent text-on-accent flex items-center justify-center shadow-sm">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <h3 className="title-hand text-[31px] text-stone-900 dark:text-stone-100">
                Your shelf is empty
              </h3>
              <p className="text-[13px] text-muted mt-1.5 max-w-md">
                Add a PDF, EPUB, DOCX, or text file. Everything stays local on your device.
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-gold">
              Add your first document <ArrowRight className="w-4 h-4" />
            </span>
          </button>
        ) : visible.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-center">
            <FileText className="w-6 h-6 text-stone-400" />
            <p className="font-serif text-[15px] text-stone-700 dark:text-stone-300">
              No documents match your filter
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setFormatFilter('all');
              }}
              className="font-spine text-[12px] font-semibold text-gold hover:underline cursor-pointer"
            >
              Reset filters
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          /* ── THE BOOKSHELF ── */
          <div id="stored-library">
            <Bookshelf
              docs={visible}
              groupByMonth={sortOrder === 'recent'}
              themes={settings.activeThemes}
              busyId={busyId}
              onOpen={(doc) => onOpenStoredDocument?.(doc)}
              onRename={commitRename}
              onDelete={commitDelete}
            />
          </div>
        ) : (
          /* ── COMPACT BIBLIOGRAPHY LIST VIEW ── */
          <div
            id="stored-library"
            className={`rounded-2xl border overflow-hidden ${
              isDark ? 'bg-night-4 border-stone-800' : 'bg-white border-stone-200/90'
            }`}
          >
            <div
              className={`grid grid-cols-12 gap-2 px-4 py-2.5 text-[11px] font-spine uppercase tracking-wider text-muted border-b ${
                isDark ? 'border-stone-800 bg-night-2' : 'border-stone-200/70 bg-stone-50'
              }`}
            >
              <div className="col-span-6">Title</div>
              <div className="col-span-2">Format</div>
              <div className="col-span-2 text-right">Words & Marks</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <div className="divide-y divide-stone-100 dark:divide-stone-800/80">
              {visible.map((doc) => (
                <div
                  key={doc.id}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-[13px] transition-colors ${
                    isDark ? 'hover:bg-white/2' : 'hover:bg-stone-50'
                  }`}
                >
                  <div className="col-span-6 flex items-center gap-3 min-w-0">
                    <BookMarked className="w-4 h-4 text-gold shrink-0" />
                    <button
                      type="button"
                      onClick={() => onOpenStoredDocument?.(doc)}
                      className="font-serif font-semibold text-stone-900 dark:text-stone-100 truncate hover:text-gold text-left cursor-pointer"
                    >
                      {doc.title}
                    </button>
                  </div>

                  <div className="col-span-2 font-spine text-[11px] text-muted uppercase">
                    {doc.format}
                    {typeof doc.progressPercent === 'number' && (
                      <span className="normal-case" title={progressLabel(doc)}> · {Math.round(doc.progressPercent)}%</span>
                    )}
                  </div>

                  <div className="col-span-2 text-right font-spine text-[11.5px] tabular-nums text-muted">
                    <span>{doc.wordCount.toLocaleString()}w</span>
                    {doc.annotationCount > 0 && (
                      <span className="ml-2 text-gold font-semibold">
                        · {doc.annotationCount}m
                      </span>
                    )}
                  </div>

                  <div className="col-span-2 flex items-center justify-end gap-1 text-[11px]">
                    {/* The confirm step lives here too. It used to exist only in the grid, so the
                        list's trash button set a pending-delete nobody could see or act on — and
                        switching to grid afterwards showed a card asking to be deleted that the
                        reader had never chosen. */}
                    {confirmingDeleteId === doc.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void commitDelete(doc.id)}
                          disabled={busyId === doc.id}
                          className="px-2 py-1 rounded text-red-600 dark:text-red-400 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer disabled:opacity-50"
                        >
                          {busyId === doc.id ? 'Deleting…' : 'Delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          className="px-2 py-1 rounded text-muted hover:bg-stone-200/60 dark:hover:bg-stone-800 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onOpenStoredDocument?.(doc)}
                          className="px-2 py-1 rounded hover:bg-stone-200/60 dark:hover:bg-stone-800 text-gold font-medium cursor-pointer"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(doc.id)}
                          aria-label={`Delete ${doc.title}`}
                          title={`Delete ${doc.title}`}
                          className="p-1 rounded text-muted hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
  </>
);
