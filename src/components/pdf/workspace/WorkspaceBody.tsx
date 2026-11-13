/**
 * The PDF workspace's body: the pages (single, book, spread or grid) and the marks panel beside them
 * (moved verbatim from PdfWorkspace).
 */

import React from 'react';
import { type PDFDocumentProxy } from 'pdfjs-dist';
import { Loader2, FileWarning, ChevronLeft, ChevronRight } from '../../icons';
import { UserSettings } from '../../../types';
import {
  Annotation,
  BracketSide,
  NoteStyle,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont
} from '../annotationModel';
import { PdfPage } from '../PdfPage';
import { NotesList } from '../NotesList';
import { type PdfViewMode } from '../../../utils/documentStorage';

export interface WorkspaceBodyProps {
  activeColor: string;
  activeThemeIds: string[];
  annotations: Annotation[];
  bookOn: boolean;
  bookRef: React.RefObject<HTMLDivElement>;
  bracketSide: BracketSide;
  byPage: Map<number, Annotation[]>;
  createAnnotation: (annotation: Annotation) => void;
  currentPage: number;
  deleteAnnotation: (id: string) => void;
  goToPage: (page: number, animate?: boolean) => void;
  handleDeletePage: (pageNumber: number) => Promise<void>;
  hoveredId: string;
  isDark: boolean;
  isPanelOpen: boolean;
  loadError: string;
  noteStyle: NoteStyle;
  pageCount: number;
  pdf: PDFDocumentProxy;
  retagAnnotation: (id: string, themeId: string | null, color: string) => void;
  scale: number;
  scrollRef: React.RefObject<HTMLDivElement>;
  scrollToAnnotation: (a: Annotation) => boolean;
  selectedId: string;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  setHoveredId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string>>;
  settings: UserSettings;
  startEditing: (id: string) => void;
  textAlign: TextAlign;
  textBold: boolean;
  textFont: TextFont;
  textItalic: boolean;
  textSize: number;
  tool: PdfTool;
  toolStrokeStyles: Record<string, StrokeStyle>;
  toolWeights: Record<string, number>;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  viewMode: PdfViewMode;
}

export const WorkspaceBody: React.FC<WorkspaceBodyProps> = ({ activeColor, activeThemeIds, annotations, bookOn, bookRef, bracketSide, byPage, createAnnotation, currentPage, deleteAnnotation, goToPage, handleDeletePage, hoveredId, isDark, isPanelOpen, loadError, noteStyle, pageCount, pdf, retagAnnotation, scale, scrollRef, scrollToAnnotation, selectedId, setCurrentPage, setHoveredId, setSelectedId, settings, startEditing, textAlign, textBold, textFont, textItalic, textSize, tool, toolStrokeStyles, toolWeights, updateAnnotation, viewMode }) => (
  <>
      <div className="flex-1 flex min-h-0 min-w-0">
        <div
          ref={scrollRef}
          data-annotation-surface
          className="flex-1 min-w-0 min-h-0 overflow-auto px-4 py-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          {loadError ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <FileWarning className="w-8 h-8 text-amber-500" />
              <p className="text-[13px] text-stone-600 dark:text-stone-400 max-w-sm">{loadError}</p>
            </div>
          ) : !pdf ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
              <p className="text-[12px] text-muted">Opening document…</p>
            </div>
          ) : (() => {
            const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);
            const renderPage = (pageNumber: number, offstage = false) => (
              <PdfPage
                key={pageNumber}
                offstage={offstage}
                pdf={pdf}
                pageNumber={pageNumber}
                scale={scale}
                annotations={byPage.get(pageNumber) || []}
                tool={tool}
                activeColor={activeColor}
                activeThemeIds={activeThemeIds}
                themes={settings.activeThemes}
                terminologyColor={settings.terminologyColor}
                toolWeight={toolWeights[tool]}
                toolStrokeStyle={toolStrokeStyles[tool]}
                toolNoteStyle={noteStyle}
                toolBracketSide={bracketSide}
                toolTextSize={textSize}
                toolTextAlign={textAlign}
                toolTextFont={textFont}
                toolTextBold={textBold}
                toolTextItalic={textItalic}
                isDark={isDark}
                selectedId={selectedId}
                hoveredId={hoveredId}
                onSelect={setSelectedId}
                onCreate={createAnnotation}
                onDelete={deleteAnnotation}
                onEdit={startEditing}
                onUpdate={updateAnnotation}
                onHover={setHoveredId}
                onVisible={setCurrentPage}
                onDeletePage={pageCount > 1 ? () => void handleDeletePage(pageNumber) : undefined}
              />
            );

            // Spread groups pages two to a row, like an open book — everything else about a page
            // (its own AnnotationLayer, its own coordinate space) is unaffected by how it's laid
            // out among its neighbours, so this is purely a container change.
            if (bookOn) {
              const first = Math.floor((currentPage - 1) / 2) * 2 + 1;
              const pair = [first, first + 1].filter((n) => n <= pageCount);
              // The pairs either side, drawn ahead and kept offstage in the same parent, so a turn
              // shows finished pages and React keeps each page (and its canvas) as it moves into view.
              const near = [first - 2, first - 1, first + 2, first + 3].filter((n) => n >= 1 && n <= pageCount);
              return (
                <div className="flex items-center justify-center gap-1 min-h-full">
                  <button
                    type="button"
                    data-inline
                    className="spread-edge"
                    onClick={() => goToPage(first - 2)}
                    disabled={first <= 1}
                    aria-label="Previous pages (Left arrow)"
                    title="Previous pages (←)"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div ref={bookRef} className="spread-book relative flex items-start" style={{ marginInline: 0 }}>
                    {[...near.filter((n) => n < first), ...pair, ...near.filter((n) => n > first)].map((n) => renderPage(n, !pair.includes(n)))}
                    {pair.length === 2 && <div className="spread-gutter" aria-hidden />}
                  </div>
                  <button
                    type="button"
                    data-inline
                    className="spread-edge"
                    onClick={() => goToPage(first + 2)}
                    disabled={first + 2 > pageCount}
                    aria-label="Next pages (Right arrow)"
                    title="Next pages (→)"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              );
            }

            // Four or six pages in view: a grid of two or three columns, every page still its own
            // annotation surface; scrolling moves on through the document.
            if (viewMode === 'grid4' || viewMode === 'grid6') {
              return (
                <div className={`grid gap-5 justify-center items-start ${viewMode === 'grid6' ? 'grid-cols-[repeat(3,max-content)]' : 'grid-cols-[repeat(2,max-content)]'}`}>
                  {pageNumbers.map((n) => renderPage(n))}
                </div>
              );
            }

            if (viewMode === 'spread') {
              const pairs: number[][] = [];
              for (let i = 0; i < pageNumbers.length; i += 2) pairs.push(pageNumbers.slice(i, i + 2));
              return (
                <div className="space-y-5">
                  {pairs.map((pair) => (
                    <div key={pair[0]} className="flex flex-wrap items-start justify-center gap-5">
                      {pair.map((n) => renderPage(n))}
                    </div>
                  ))}
                </div>
              );
            }

            return <div className="space-y-5">{pageNumbers.map((n) => renderPage(n))}</div>;
          })()}
        </div>

        {/* The marks panel stays mounted while hidden, so closing and reopening it is cheap. */}
        <div
          // Docked beside the pages on a wide window; an overlay once the window is too narrow
          // to give it a column. It used to be `hidden md:flex`, which left both toggles in the
          // header doing visibly nothing on a small window.
          className={`flex-col min-h-0 border-l z-30 max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:w-full max-md:max-w-sm max-md:shadow-2xl md:w-80 md:shrink-0 ${
            isPanelOpen ? 'flex' : 'hidden'
          } ${isDark ? 'bg-night-1 border-stone-800' : 'bg-white border-stone-200'}`}
        >
          <div
            className="min-h-0 flex-1 flex flex-col motion-safe:animate-[panel-in_200ms_var(--ease-out)]"
          >
            <NotesList
              annotations={annotations}
              settings={settings}
              isDark={isDark}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onSelect={(a) => {
                setSelectedId(a.id);
                scrollToAnnotation(a);
              }}
              onRetag={retagAnnotation}
              onDelete={deleteAnnotation}
              onEdit={startEditing}
            />
          </div>
        </div>
      </div>
  </>
);
