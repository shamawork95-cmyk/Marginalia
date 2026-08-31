import React, { useEffect, useState } from 'react';
import { BookOpen, Settings as SettingsIcon, PlusCircle, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Screen, TransitionType } from '../types';

/**
 * Remembered across sessions, because a collapsed sidebar is a standing preference about how much
 * of the window belongs to the document rather than a per-visit decision.
 */
const COLLAPSED_KEY = 'marginalia:sidebar-collapsed';

interface DesktopNavProps {
  currentScreen: Screen;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  hasActiveDocument?: boolean;
}

export const DesktopNav: React.FC<DesktopNavProps> = ({
  currentScreen,
  onNavigate,
  isDark = false,
  hasActiveDocument = true
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      // A blocked storage quota is not a reason to stop the sidebar working this session.
    }
  }, [collapsed]);

  const tabs: Array<{
    id: Screen;
    label: string;
    icon: React.ElementType;
    screen: Screen;
    transition: TransitionType;
  }> = [
    // Library, Add Document and Settings only. Reading and analysis are reached from a document
    // rather than from the sidebar.
    { id: 'home', label: 'Library', icon: BookOpen, screen: 'home', transition: 'push_back' },
    { id: 'upload', label: 'Add Document', icon: PlusCircle, screen: 'upload', transition: 'push' },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, screen: 'settings', transition: 'push' }
  ];

  const isActive = (tab: typeof tabs[number]) => {
    // Reading and analysis both belong to a document opened from the library.
    if (tab.id === 'home') return currentScreen === 'home' || currentScreen === 'reader' || currentScreen === 'analysis';
    return currentScreen === tab.id;
  };

  return (
    <aside
      id="desktop-sidebar-nav"
      className={`hidden md:flex flex-col shrink-0 border-r h-screen sticky top-0 transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-55'
      } ${isDark ? 'bg-[#121514] border-white/5' : 'bg-[#f9f9f7] border-black/4'}`}
    >
      {/* Brand, and the control that gives the window back to the document. */}
      <div className={`flex items-center pt-6 pb-4 ${collapsed ? 'flex-col gap-3 px-2' : 'px-4 gap-2'}`}>
        {!collapsed && (
          <h1
            onClick={() => onNavigate('home', 'push_back')}
            className="font-serif text-[22px] font-normal tracking-tight cursor-pointer hover:opacity-80 transition-opacity text-stone-900 dark:text-white select-none flex-1 min-w-0 truncate"
          >
            Marginalia
          </h1>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          aria-expanded={!collapsed}
          className="p-1.5 rounded-lg shrink-0 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-200/70 dark:hover:bg-white/5 cursor-pointer transition-colors"
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav Items */}
      <nav className={`flex-1 space-y-1 pt-2 ${collapsed ? 'px-2' : 'px-3'}`}>
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
              onClick={() => {
                if (!isDisabled && currentScreen !== tab.screen) {
                  onNavigate(tab.screen, tab.transition);
                }
              }}
              className={`w-full flex items-center rounded-xl text-[13px] font-medium transition-all active:scale-[0.97] ${
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5'
              } ${
                isDisabled
                  ? 'cursor-not-allowed text-stone-300 dark:text-stone-700'
                  : `cursor-pointer ${
                      active
                        ? 'bg-[#435c52] text-white shadow-sm'
                        : isDark
                          ? 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                          : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100/80'
                    }`
              }`}
              title={isDisabled ? 'Upload a document to start reading' : collapsed ? tab.label : undefined}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span>{tab.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom section */}
      {!collapsed && (
        <div className={`px-4 py-4 border-t text-[11px] text-stone-500 dark:text-stone-600 ${
          isDark ? 'border-white/5' : 'border-black/4'
        }`}>
          <span>Marginalia • AI Reading</span>
        </div>
      )}
    </aside>
  );
};
