import React from 'react';
import { BookOpen, Settings as SettingsIcon, PlusCircle, PanelLeftClose, PanelLeftOpen, Search, Feedback } from './icons';
import { openFeedback } from './Feedback';
import { Screen, TransitionType } from '../types';
import logo from '../assets/images/marginalia-logo.png';

interface DesktopNavProps {
  currentScreen: Screen;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  hasActiveDocument?: boolean;
  /**
   * A collapsed sidebar is a standing preference about how much of the window belongs to the
   * document rather than a per-visit decision, so it lives in `UserSettings` (server-backed) —
   * not local component state — the same as every other reading preference. Controlled from
   * `App.tsx` rather than owned here so it persists the same way settings changed from Settings
   * itself do.
   */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /**
   * Opens search. Its only trigger used to be the mobile header, which is `md:hidden` — and the
   * desktop window's minimum is 900px, so search could not be opened in the desktop app at all.
   */
  onOpenSearch?: () => void;
}

export const DesktopNav: React.FC<DesktopNavProps> = ({
  currentScreen,
  onNavigate,
  isDark = false,
  hasActiveDocument = true,
  collapsed,
  onToggleCollapsed,
  onOpenSearch
}) => {

  const tabs: Array<{
    id: Screen;
    label: string;
    icon: React.ElementType;
    screen: Screen;
    transition: TransitionType;
  }> = [
    // My Collections, Add Document and Settings only. Reading is reached from a document
    // rather than from the sidebar.
    { id: 'home', label: 'My Collections', icon: BookOpen, screen: 'home', transition: 'push_back' },
    { id: 'upload', label: 'Add Document', icon: PlusCircle, screen: 'upload', transition: 'push' },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, screen: 'settings', transition: 'push' }
  ];

  const isActive = (tab: typeof tabs[number]) => {
    // Reading a document opened from the library still belongs to the Library tab.
    if (tab.id === 'home') return currentScreen === 'home' || currentScreen === 'reader';
    return currentScreen === tab.id;
  };

  return (
    <aside
      id="desktop-sidebar-nav"
      className={`relative hidden md:flex flex-col shrink-0 h-screen sticky top-0 transition-all duration-200 overflow-hidden ${
        // 80px, not 64: macOS's three window buttons span about 78px including their margin, so a
        // narrower collapsed rail put the zoom button half over the content area with the
        // sidebar's own edge running between them. The rail is now wider than they are.
        collapsed ? 'w-20' : 'w-55'
      } ${isDark ? 'bg-night' : 'bg-paper'}`}
    >
      {/*
        The sidebar's edge, drawn from below the title bar rather than by a `border-r` on the
        aside itself.
        
        macOS puts its close/minimise/zoom buttons in the window's top-left corner, which — with
        the system title bar hidden — is inside this sidebar. A full-height border ran a hairline
        straight through them, and when the sidebar is collapsed to 64px the buttons are wider
        than the column, so the line cut across them. Starting the edge below that zone leaves the
        corner clean on every platform, and costs nothing where there are no traffic lights.
      */}
      <span
        aria-hidden
        className={`absolute top-12 right-0 bottom-0 w-px ${isDark ? 'bg-white/5' : 'bg-black/4'}`}
      />
      {/* Brand. Also a drag handle: on macOS the traffic lights sit in this corner and the rest
          of the row is the only chrome the window has left to be moved by. The collapse toggle
          lives at the bottom of the sidebar, never beside the logo. */}
      <div
        className={`app-drag flex items-center pb-4 overflow-hidden ${
          // Collapsed, this column starts under macOS's traffic lights, so it begins lower than
          // the expanded sidebar does — where the wordmark is tall enough to clear them anyway.
          collapsed ? 'justify-center px-2 pt-11' : 'px-4 pt-6'
        }`}
      >
        {!collapsed && (
          <h1
            onClick={() => onNavigate('home', 'push_back')}
            className="cursor-pointer hover:opacity-80 transition-opacity select-none flex-1 min-w-0 overflow-hidden"
          >
            <img src={logo} alt="Marginalia" className="block h-auto w-auto max-h-20 max-w-full shrink-0 dark:box-content dark:max-w-[calc(100%-1rem)] dark:bg-paper dark:rounded-2xl dark:p-2" />
          </h1>
        )}
        {collapsed && (
          // The wordmark does not survive a 64px column, so the icon stands in for it. Same
          // artwork as the app icon and the tab favicon, so the mark is one thing everywhere.
          <button
            type="button"
            onClick={() => onNavigate('home', 'push_back')}
            title="Marginalia"
            className="shrink-0 rounded-xl cursor-pointer transition-transform duration-150 ease-out hover:opacity-85 active:scale-[0.94]"
          >
            <img src="/favicon.png" alt="Marginalia" className="w-10 h-10 rounded-xl" />
          </button>
        )}
      </div>

      {/* Nav Items */}
      <nav className={`flex-1 space-y-1 pt-2 overflow-hidden ${collapsed ? 'px-2' : 'px-3'}`}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab);
          // Every remaining destination works with or without a document open.
          const isDisabled = false;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={isDisabled}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (!isDisabled && currentScreen !== tab.screen) {
                  onNavigate(tab.screen, tab.transition);
                }
              }}
              className={`w-full flex items-center rounded-xl text-[13px] font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] whitespace-nowrap overflow-hidden ${
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5'
              } ${
                isDisabled
                  ? 'cursor-not-allowed text-stone-300 dark:text-stone-700'
                  : `cursor-pointer ${
                      active
                        ? 'bg-nav-active text-nav-active-fg'
                        : `${isDark ? 'text-stone-400' : 'text-stone-600'} hover:text-nav-active-fg hover:bg-nav-hover`
                    }`
              }`}
              title={isDisabled ? 'Upload a document to start reading' : collapsed ? tab.label : undefined}
            >
              {/* Larger when collapsed: with the labels gone the glyph is the whole control, and
                  a 16px icon alone in an 80px rail reads as an afterthought. */}
              <Icon className={`shrink-0 ${collapsed ? 'w-5.5 h-5.5' : 'w-4 h-4'}`} />
              {!collapsed && <span className="caps font-spine truncate whitespace-nowrap">{tab.label}</span>}
            </button>
          );
        })}

        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            title={collapsed ? 'Search' : undefined}
            className={`w-full flex items-center rounded-xl text-[13px] font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] cursor-pointer ${
              collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5'
            } ${
              isDark ? 'text-stone-400' : 'text-stone-600'
            } hover:text-nav-active-fg hover:bg-nav-hover`}
          >
            <Search className={`shrink-0 ${collapsed ? 'w-5.5 h-5.5' : 'w-4 h-4'}`} />
            {!collapsed && <span className="caps font-spine">Search</span>}
          </button>
        )}

        <button
          type="button"
          onClick={openFeedback}
          title={collapsed ? 'Send feedback' : 'Tell the Marginalia team what you think'}
          className={`w-full flex items-center rounded-xl text-[13px] font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] cursor-pointer ${
            collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5'
          } ${
            isDark ? 'text-stone-400' : 'text-stone-600'
          } hover:text-nav-active-fg hover:bg-nav-hover`}
        >
          <Feedback className={`shrink-0 ${collapsed ? 'w-5.5 h-5.5' : 'w-4 h-4'}`} />
          {!collapsed && <span className="caps font-spine">Send feedback</span>}
        </button>

      </nav>

      {/* The control that gives the window back to the document. Same spot in both states:
          24px from the left edge (centred in the 80px rail), and the same height from the
          bottom, because the credit below keeps its height while hidden in the collapsed rail. */}
      <div className="px-6 pb-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          aria-controls="desktop-sidebar-nav"
          className="flex p-1.5 rounded-lg text-muted hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-200/70 dark:hover:bg-white/5 cursor-pointer transition-colors duration-150 ease-out"
        >
          {/* One glyph, mirrored. Phosphor has no open/close pair for a sidebar, and the
              direction is the whole message: the panel opens the way the icon points. */}
          <PanelLeftOpen className={`w-5 h-5 transition-transform duration-200 ease-out ${collapsed ? '' : 'scale-x-[-1]'}`} />
        </button>
      </div>

      {/* Credit. Hidden, not removed, in the collapsed rail so the toggle above never moves. */}
      <div
        aria-hidden={collapsed || undefined}
        className={`px-4 py-4 border-t text-[13px] text-muted space-y-1.5 overflow-hidden whitespace-nowrap ${
          collapsed ? 'invisible' : ''
        } ${isDark ? 'border-white/5' : 'border-black/4'}`}
      >
        <span className="font-spine text-[14px] text-gold block truncate whitespace-nowrap">
          Marginalia • Annotator
        </span>
        <p className="font-spine italic text-[12px] text-muted leading-snug truncate whitespace-nowrap">
          For close readers,
        </p>
        <p className="font-spine italic text-[12px] text-muted leading-snug truncate whitespace-nowrap">
          Built with care by
          <br />
          Shama Iqbal Hussain.
        </p>
      </div>
    </aside>
  );
};
