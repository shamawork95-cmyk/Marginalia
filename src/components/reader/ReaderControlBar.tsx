/**
 * The reader's control bar (inside focus mode's sliding chrome): tabs, the poetry view, the text tools,
 * undo, Find, spread, the marks panel and focus mode, with the Find bar and the poetry panel under it
 * (moved verbatim from ReaderScreen).
 */

import React from 'react';
import {
  StickyNote as StickyNoteIcon,
  Plus,
  Undo2,
  Redo2,
  PanelRightOpen,
  Download,
  BookOpen,
  Maximize2,
  Minimize2,
  Search,
  Feather,
  Board as BoardIcon
} from '../icons';
import { PoetryPanel } from '../PoetryView';
import { FindBar, FIND_SHORTCUT } from '../FindBar';
import { FocusChrome, FocusExit, FOCUS_HOTKEY } from '../FocusMode';
import type { ThemeStore } from '../themeStore';
import { PoetryPrefs, ReaderJump, UserSettings } from '../../types';
import { HoverTooltip } from '../HoverTooltip';
import { ParagraphRange } from '../../utils/textFormatting';
import { type TextMark } from '../../utils/textMarks';
import { TOOL_HOTKEYS, withShortcut } from '../pdf/workspaceKeys';
import { plural } from '../../utils/plural';
import { IS_APPLE, MODIFIER, SHIFT_MODIFIER, TextTool, TEXT_TOOLS, Tab } from './readerParts';
import type { DocumentFind } from '../FindBar';
import type { PoemAnalysis } from '../../utils/poetry';
import type { Annotation } from '../pdf/annotationModel';

export interface ReaderControlBarProps {
  activeColor: string;
  activeControlTab: Tab;
  activeJump: ReaderJump;
  activeParagraphIndex: number;
  addProsodyThemes: () => void;
  canRedo: boolean;
  canUndo: boolean;
  controlBarRef: React.RefObject<HTMLDivElement>;
  createParagraphNote: (paraIdx: number) => void;
  docId: string;
  find: DocumentFind;
  focusMode: boolean;
  handleSwitchTab: (newTab: Tab) => void;
  handleToolTap: (next: TextTool) => void;
  iconBtn: "p-2 rounded-lg text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-stone-800 dark:hover:text-stone-200 disabled:opacity-30 cursor-pointer disabled:cursor-default shrink-0";
  isDark: boolean;
  isPanelOpen: boolean;
  missingProsody: { name: string; color: string; }[];
  noteHeads: TextMark[];
  onToggleFocus: () => void;
  pendingSelection: ParagraphRange[];
  pillClass: (active: boolean) => string;
  poem: PoemAnalysis;
  poetry: PoetryPrefs;
  poetryOpen: boolean;
  redo: () => void;
  selectedIds: string[];
  setActiveJump: React.Dispatch<React.SetStateAction<ReaderJump>>;
  setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPoetry: (next: PoetryPrefs) => void;
  setPoetryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowInlineNotes: React.Dispatch<React.SetStateAction<boolean>>;
  settings: UserSettings;
  showInlineNotes: boolean;
  spreadFits: boolean;
  spreadOn: boolean;
  spreadPref: boolean;
  themeStore: ThemeStore;
  toggleSpread: () => void;
  tool: TextTool;
  undo: () => void;
  views: Annotation[];
}

export const ReaderControlBar: React.FC<ReaderControlBarProps> = ({ activeColor, activeControlTab, activeJump, activeParagraphIndex, addProsodyThemes, canRedo, canUndo, controlBarRef, createParagraphNote, docId, find, focusMode, handleSwitchTab, handleToolTap, iconBtn, isDark, isPanelOpen, missingProsody, noteHeads, onToggleFocus, pendingSelection, pillClass, poem, poetry, poetryOpen, redo, selectedIds, setActiveJump, setIsPanelOpen, setPoetry, setPoetryOpen, setShowInlineNotes, settings, showInlineNotes, spreadFits, spreadOn, spreadPref, themeStore, toggleSpread, tool, undo, views }) => (
  <>
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
              <span className="font-spine whitespace-nowrap animate-in fade-in duration-150">
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
                  data-mark-tool
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
  </>
);
