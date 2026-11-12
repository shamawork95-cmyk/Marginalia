/**
 * The reader's top: the Tagging as theme strip and the header with the title and Settings (moved
 * verbatim from ReaderScreen).
 */

import React from 'react';
import { ArrowLeft, Settings as SettingsIcon } from '../icons';
import { Screen, TransitionType, UserSettings } from '../../types';

export interface ReaderHeaderProps {
  activeThemeId: string;
  displayTitle: string;
  focusMode: boolean;
  headerRef: React.RefObject<HTMLElement>;
  isDark: boolean;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  setActiveThemeId: React.Dispatch<React.SetStateAction<string>>;
  settings: UserSettings;
  themeStripRef: React.RefObject<HTMLDivElement>;
}

export const ReaderHeader: React.FC<ReaderHeaderProps> = ({ activeThemeId, displayTitle, focusMode, headerRef, isDark, onNavigate, setActiveThemeId, settings, themeStripRef }) => (
  <>
      {/* Theme picker — which theme new marks are filed under, and so their colour. */}
      <div
        hidden={focusMode}
        className={`pl-3 sm:pl-6 py-2 border-b flex items-center gap-1.5 text-[11px] w-full max-w-full ${
          isDark ? 'bg-night-2 border-stone-800/80' : 'bg-stone-100 border-stone-200'
        }`}
      >
        {/* The label stays put; only the chips scroll, so it is never clipped at 320 px. */}
        <span className="font-semibold text-muted shrink-0">Tagging as</span>
        <div
          ref={themeStripRef}
          className="chip-strip min-w-0 flex-1 flex items-center gap-1.5 pr-3 sm:pr-6 overflow-x-auto snap-x snap-mandatory scroll-smooth"
        >
        {settings.activeThemes.map((theme, i) => (
          <button
            key={theme.id}
            data-theme-id={theme.id}
            type="button"
            onClick={() => setActiveThemeId(theme.id)}
            aria-pressed={activeThemeId === theme.id}
            aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
            className={`px-2 py-0.5 rounded-lg font-medium transition-all flex items-center gap-1.5 cursor-pointer shrink-0 snap-start ${
              activeThemeId === theme.id
                ? 'bg-stone-900 dark:bg-white text-white dark:text-stone-900 shadow-xs'
                : 'text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: theme.color }} />
            <span className="whitespace-nowrap">{theme.name}</span>
          </button>
        ))}
        </div>
      </div>

      {/* Top Reader Navigation Bar */}
      <header
        ref={headerRef}
        hidden={focusMode}
        className={`app-drag sticky top-0 z-40 px-3 sm:px-6 h-18 border-b flex items-center justify-between gap-2 backdrop-blur-md transition-colors w-full max-w-full overflow-hidden ${
          isDark ? 'bg-night/90 border-stone-800' : 'bg-paper/90 border-stone-200/80'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 max-w-[65%] sm:max-w-md">
          <button
            id="reader-back-library-btn"
            type="button"
            onClick={() => onNavigate('home', 'push_back')}
            className="p-1.5 rounded-xl text-stone-700 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            title="Back to My Collections"
            aria-label="Back to My Collections"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 truncate">
            <h1 className="title-hand text-[22px] sm:text-[25px] truncate text-stone-900 dark:text-paper">
              {displayTitle}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            id="reader-top-settings-btn"
            type="button"
            onClick={() => onNavigate('settings', 'push')}
            className="p-1.5 sm:p-2 rounded-xl text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            aria-label="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </header>
  </>
);
