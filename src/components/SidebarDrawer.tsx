import React from 'react';
import { X, BookOpen, PlusCircle, Settings, Feedback } from './icons';
import { openFeedback } from './Feedback';
import { Screen, TransitionType } from '../types';
import { AnimatePresence, motion } from 'motion/react';
import logo from '../assets/images/marginalia-logo.png';

interface SidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  /** Marks the matching link as the selected tab; omit and no link is marked. */
  currentScreen?: Screen;
}

export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  isOpen,
  onClose,
  onNavigate,
  isDark = false,
  currentScreen
}) => {
  const link = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-colors duration-150 ease-out text-left ${
      active ? 'bg-nav-active text-nav-active-fg' : 'hover:bg-nav-hover hover:text-nav-active-fg'
    }`;
  // The selected tab's icon takes the pill's ink; the rest keep their gold.
  const icon = (active: boolean) => `w-4 h-4 ${active ? '' : 'text-gold'}`;
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
          />

          {/* Drawer Panel */}
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className={`relative z-10 w-72 max-w-[80vw] h-full p-6 flex flex-col justify-between shadow-2xl border-r ${
              isDark ? 'bg-night-1 border-stone-800 text-paper' : 'bg-paper border-stone-200 text-stone-900'
            }`}
          >
            <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
            <h2>
              <img src={logo} alt="Marginalia" className="block h-auto w-auto max-h-16 max-w-full shrink-0 dark:box-content dark:max-w-[calc(100%-1rem)] dark:bg-paper dark:rounded-2xl dark:p-2" />
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-muted hover:text-stone-600 dark:hover:text-stone-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigate('home', 'push_back');
              }}
              className={link(currentScreen === 'home' || currentScreen === 'reader')}
            >
              <BookOpen className={icon(currentScreen === 'home' || currentScreen === 'reader')} />
              <span className="caps font-spine">My Collections</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigate('upload', 'push');
              }}
              className={link(currentScreen === 'upload')}
            >
              <PlusCircle className={icon(currentScreen === 'upload')} />
              <span className="caps font-spine">Add Document</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigate('settings', 'push');
              }}
              className={link(currentScreen === 'settings')}
            >
              <Settings className={icon(currentScreen === 'settings')} />
              <span className="caps font-spine">Settings</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                openFeedback();
              }}
              className={link(false)}
            >
              <Feedback className={icon(false)} />
              <span className="caps font-spine">Send feedback</span>
            </button>
          </nav>
        </div>

        {/* Footer info */}
        <div className="pt-4 border-t border-stone-200 dark:border-stone-800 text-[11px] text-muted space-y-1 font-spine">
          <p className="text-[14px] text-gold">Marginalia</p>
          <p>Mindful reading, kept in the margins</p>
          <p className="italic pt-1">
            For close readers,
            <br />
            Built with care by Shama Iqbal Hussain.
          </p>
        </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
