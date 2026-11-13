/**
 * Settings: reading preferences, the reader's own ink colours and the terminology colour (moved
 * verbatim from SettingsScreen).
 */

import React from 'react';
import { ChevronDown, Plus, X, Droplet, Tag } from '../icons';
import { UserSettings } from '../../types';

export interface SettingsReadingProps {
  MAX_CUSTOM_COLORS: 8;
  handleAddCustomColor: () => void;
  handleRemoveCustomColor: (index: number) => void;
  handleUpdateCustomColor: (index: number, color: string) => void;
  isDark: boolean;
  onUpdateSettings: (updater: (prev: UserSettings) => UserSettings) => void;
  settings: UserSettings;
}

export const SettingsReading: React.FC<SettingsReadingProps> = ({ MAX_CUSTOM_COLORS, handleAddCustomColor, handleRemoveCustomColor, handleUpdateCustomColor, isDark, onUpdateSettings, settings }) => (
  <>
      {/* READING PREFERENCES Section */}
      <section
        id="settings-reading-preferences-section"
        className={`p-5 rounded-2xl border transition-all space-y-5 ${
          isDark
            ? 'bg-night-3 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <span className="caps font-spine text-muted block">
          READING PREFERENCES
        </span>

        {/* Typography */}
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-stone-700 dark:text-stone-300">
            Typography
          </label>
          <div className="relative">
            <select
              value={settings.typography}
              onChange={(e) => onUpdateSettings((p) => ({ ...p, typography: e.target.value }))}
              className={`w-full border rounded-xl px-4 py-3 text-[14px] appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-gold ${
                isDark
                  ? 'bg-night-5 border-stone-700/80 text-paper'
                  : 'bg-stone-50 border-stone-300/80 text-stone-900'
              }`}
            >
              <option value="Literata (Default)">Literata (Default)</option>
              <option value="Newsreader">Newsreader</option>
              <option value="System Serif">Georgia / Classic Serif</option>
              <option value="Plus Jakarta Sans">Modern Sans-Serif</option>
            </select>
            <ChevronDown className="w-4 h-4 text-stone-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Urdu, Persian and Arabic text: read right to left; Nastaliq or Naskh. */}
        <div className="space-y-1.5 pt-1 border-t border-stone-200 dark:border-stone-700/50">
          <label htmlFor="arabic-script" className="text-[13px] font-medium text-stone-700 dark:text-stone-300">
            Urdu, Persian and Arabic text
          </label>
          <div className="relative">
            <select
              id="arabic-script"
              value={settings.arabicScript ?? 'nastaliq'}
              onChange={(e) => onUpdateSettings((p) => ({ ...p, arabicScript: e.target.value as 'nastaliq' | 'naskh' }))}
              className={`w-full border rounded-xl px-4 py-3 text-[14px] appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-gold ${
                isDark ? 'bg-night-5 border-stone-700/80 text-paper' : 'bg-stone-50 border-stone-300/80 text-stone-900'
              }`}
            >
              <option value="nastaliq">Nastaliq (نستعلیق)</option>
              <option value="naskh">Naskh (نسخ)</option>
            </select>
            <ChevronDown className="w-4 h-4 text-stone-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <p className="text-[12px] text-muted leading-snug">
            Right-to-left passages always read right to left, in the reader and in exports.
          </p>
        </div>

        {/* Font Size Slider */}
        <div className="space-y-2 pt-1 border-t border-stone-200 dark:border-stone-700/50">
          <div className="flex justify-between items-center text-[13px]">
            <span className="text-stone-700 dark:text-stone-300 font-medium">Font Size</span>
            <span className="text-muted">{settings.fontSize}px</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted font-serif text-[12px]">TT</span>
            <input
              type="range"
              min={14}
              max={26}
              value={settings.fontSize}
              onChange={(e) => onUpdateSettings((p) => ({ ...p, fontSize: Number(e.target.value) }))}
              className="flex-1 accent-gold h-1.5 bg-stone-200 dark:bg-stone-700 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-stone-700 dark:text-stone-400 font-serif text-[18px] font-semibold">TT</span>
          </div>
        </div>

        {/* Dark Mode Toggle */}
        <div className="flex items-center justify-between pt-3 border-t border-stone-200 dark:border-stone-700/50">
          <div className="max-w-60">
            <h4 className="text-[13px] font-medium text-stone-900 dark:text-paper">Dark Mode</h4>
            <p className="text-[12px] text-muted leading-snug">
              Switch to a darker theme for low-light environments
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.darkMode}
            aria-label="Dark mode"
            onClick={() => onUpdateSettings((p) => ({ ...p, darkMode: !p.darkMode }))}
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
              settings.darkMode ? 'bg-gold' : 'bg-stone-300 dark:bg-stone-700'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full shadow-xs absolute top-0.5 transition-transform ${
                settings.darkMode ? 'right-0.5 bg-paper dark:bg-night' : 'left-0.5 bg-white dark:bg-stone-300'
              }`}
            />
          </button>
        </div>

      </section>

      {/* The reader's own ink colours, offered wherever a colour is picked. */}
      <section
        id="settings-custom-colors-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-night-3 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Droplet className="w-3.5 h-3.5 text-muted" />
            <span className="caps font-spine text-muted">
              YOUR COLOURS
            </span>
          </div>
          <button
            type="button"
            onClick={handleAddCustomColor}
            disabled={(settings.customColors?.length ?? 0) >= MAX_CUSTOM_COLORS}
            className="flex items-center gap-1 text-[12px] font-semibold text-gold dark:text-gold hover:underline cursor-pointer disabled:opacity-40 disabled:no-underline disabled:cursor-default"
          >
            <Plus className="w-3.5 h-3.5" />
            Add colour
          </button>
        </div>
        <p className="text-[12px] text-muted mb-4">
          These appear in every colour picker in the annotating workspace, next to your themes —
          for ink that is just ink, without inventing a theme to justify it.
        </p>

        {settings.customColors?.length ? (
          <div className="flex flex-wrap gap-2.5">
            {settings.customColors.map((color, index) => (
              <div key={index} className="relative group">
                <label
                  title="Click to change this colour"
                  className="block w-11 h-11 rounded-xl border border-black/10 dark:border-white/15 cursor-pointer overflow-hidden shadow-xs"
                  style={{ backgroundColor: color }}
                >
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => handleUpdateCustomColor(index, e.target.value)}
                    className="opacity-0 w-full h-full cursor-pointer"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => handleRemoveCustomColor(index)}
                  title="Remove this colour"
                  aria-label={`Remove colour ${color}`}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow"
                >
                  <X className="w-3 h-3" />
                </button>
                <span className="block mt-1 text-[10px] text-center tabular-nums text-muted uppercase">
                  {color.replace('#', '')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 text-center">
            <p className="text-[12px] text-muted">
              No colours of your own yet. Add one and it will show up in every picker.
            </p>
          </div>
        )}
      </section>

      {/* TERMINOLOGY — one colour, not a list: every terminology mark reads this setting live
          rather than storing its own colour, so changing it here recolours every term already
          marked, not just new ones. */}
      <section
        id="settings-terminology-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-night-3 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <Tag className="w-3.5 h-3.5 text-muted" />
          <span className="caps font-spine text-muted">
            TERMINOLOGY
          </span>
        </div>
        <p className="text-[12px] text-muted mb-4">
          The colour every term you mark with the Terminology tool is shown in — across every
          document. Change it here and every term already marked updates too.
        </p>
        <div className="flex items-center gap-3">
          <label
            title="Click to change the terminology colour"
            className="block w-11 h-11 rounded-xl border border-black/10 dark:border-white/15 cursor-pointer overflow-hidden shadow-xs shrink-0"
            style={{ backgroundColor: settings.terminologyColor }}
          >
            <input
              type="color"
              value={settings.terminologyColor}
              onChange={(e) => onUpdateSettings((p) => ({ ...p, terminologyColor: e.target.value }))}
              className="opacity-0 w-full h-full cursor-pointer"
            />
          </label>
          <span className="text-[12.5px] font-spine tabular-nums text-muted uppercase">
            {settings.terminologyColor}
          </span>
        </div>
      </section>
  </>
);
