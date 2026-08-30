import React from 'react';
import { BookOpen, Settings as SettingsIcon, PlusCircle } from 'lucide-react';
import { Screen, TransitionType } from '../types';

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
      className={`hidden md:flex flex-col w-55 shrink-0 border-r h-screen sticky top-0 transition-colors ${
        isDark
          ? 'bg-[#121514] border-white/5'
          : 'bg-[#f9f9f7] border-black/4'
      }`}
    >
      {/* Brand */}
      <div className="px-6 pt-6 pb-4">
        <h1
          onClick={() => onNavigate('home', 'push_back')}
          className="font-serif text-[22px] font-normal tracking-tight cursor-pointer hover:opacity-80 transition-opacity text-stone-900 dark:text-white select-none"
        >
          Marginalia
        </h1>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 px-3 space-y-1 pt-2">
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
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all active:scale-[0.97] ${
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
              title={isDisabled ? 'Upload a document to start reading' : undefined}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className={`px-4 py-4 border-t text-[11px] text-stone-500 dark:text-stone-600 ${
        isDark ? 'border-white/5' : 'border-black/4'
      }`}>
        <span>Marginalia • AI Reading</span>
      </div>
    </aside>
  );
};
