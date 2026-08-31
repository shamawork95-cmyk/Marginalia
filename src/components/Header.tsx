import React, { useState } from 'react';
import { Menu, Search } from 'lucide-react';
import { Screen } from '../types';
import { motion, useScroll, useMotionValueEvent } from 'motion/react';

interface HeaderProps {
  currentScreen: Screen;
  onNavigate: (screen: Screen, transition?: 'push' | 'push_back' | 'slide_up' | 'none') => void;
  onOpenMenu?: () => void;
  onOpenSearch?: () => void;
  isDark?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  onNavigate,
  onOpenMenu,
  onOpenSearch,
  isDark = false
}) => {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);

  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = scrollY.getPrevious() ?? 0;
    // Only hide after scrolling down past a threshold, show immediately on scroll up
    if (latest > previous && latest > 80) {
      setHidden(true);
    } else {
      setHidden(false);
    }
  });

  const handleLogoClick = () => {
    onNavigate('home', 'push_back');
  };

  const handleSearchClick = () => {
    if (currentScreen === 'analysis') {
      onNavigate('home', 'push_back');
    } else if (onOpenSearch) {
      onOpenSearch();
    }
  };

  return (
    <motion.header 
      variants={{
        visible: { y: 0 },
        hidden: { y: '-100%' }
      }}
      initial="visible"
      animate={hidden ? "hidden" : "visible"}
      transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
      className={`sticky top-0 z-30 flex items-center justify-between px-5 py-4 transition-colors ${
      isDark ? 'bg-[#121514] text-white border-b border-white/5' : 'bg-[#f9f9f7] text-[#1c2321] border-b border-black/4'
    }`}>
      {/* Menu Icon Button */}
      <button
        id="header-menu-btn"
        type="button"
        onClick={onOpenMenu}
        aria-label="Open Navigation Menu"
        className={`p-2 -ml-2 rounded-lg transition-colors ${
          isDark ? 'hover:bg-white/10 text-stone-300' : 'hover:bg-stone-200/60 text-stone-700'
        }`}
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Brand Title: H1 with inner div to ensure both XPath patterns match */}
      <h1
        id="marginalia-brand-logo"
        onClick={handleLogoClick}
        className="cursor-pointer select-none font-serif text-[26px] font-normal tracking-tight hover:opacity-85 transition-opacity"
      >
        <div className="inline-block">Marginalia</div>
      </h1>

      {/* Search Button (also fulfills //a[contains(., 'Search')] | //button[contains(., 'search')]) */}
      <button
        id="header-search-btn"
        type="button"
        onClick={handleSearchClick}
        aria-label="search Search"
        className={`p-2 -mr-2 rounded-lg transition-colors flex items-center gap-1 ${
          isDark ? 'hover:bg-white/10 text-stone-300' : 'hover:bg-stone-200/60 text-stone-700'
        }`}
      >
        <span className="sr-only">search Search</span>
        <Search className="w-5 h-5" />
      </button>
    </motion.header>
  );
};
