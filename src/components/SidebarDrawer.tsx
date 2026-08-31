import React from 'react';
import { X, BookOpen, PlusCircle, Settings } from 'lucide-react';
import { Screen, TransitionType } from '../types';
import { AnimatePresence, motion } from 'motion/react';

interface SidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
}

export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  isOpen,
  onClose,
  onNavigate,
  isDark = false
}) => {
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
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
            className={`relative z-10 w-72 max-w-[80vw] h-full p-6 flex flex-col justify-between shadow-2xl border-r ${
              isDark ? 'bg-[#151917] border-stone-800 text-white' : 'bg-[#f9f9f7] border-stone-200 text-stone-900'
            }`}
          >
            <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
            <h2 className="font-serif text-[22px] font-semibold">Marginalia</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
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
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-[14px] font-medium transition-colors text-left"
            >
              <BookOpen className="w-4 h-4 text-[#435c52]" />
              <span>Library</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigate('upload', 'push');
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-[14px] font-medium transition-colors text-left"
            >
              <PlusCircle className="w-4 h-4 text-emerald-600" />
              <span>Scan / Upload</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigate('settings', 'push');
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-[14px] font-medium transition-colors text-left"
            >
              <Settings className="w-4 h-4 text-stone-500" />
              <span>Settings</span>
            </button>
          </nav>
        </div>

        {/* Footer info */}
        <div className="pt-4 border-t border-stone-200 dark:border-stone-800 text-[11px] text-stone-400 space-y-1">
          <p className="font-semibold text-stone-500 dark:text-stone-300">Marginalia v2.4</p>
          <p>Mindful reading and AI thematic synthesis</p>
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
