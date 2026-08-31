/**
 * Settings for the desktop app.
 *
 * Rewritten from the hosted-web version, which opened with an account card, an email address and
 * a "Free" subscription with a Manage button that did nothing. Marginalia has no accounts and no
 * server; those were props. What remains is the set of things that genuinely change how the app
 * behaves, plus the one control a desktop app owes its user and a web page cannot offer: saying
 * where on their own disk the documents live.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Plus, Sparkles, X, Check, Palette, Droplet, HardDrive, FolderOpen, Loader2, Info, RotateCcw, DownloadCloud, AlertTriangle } from 'lucide-react';
import { Screen, TransitionType, UserSettings } from '../types';
import {
  AppInfo,
  StorageInfo,
  UpdateStatus,
  desktopBridge,
  fetchStorageInfo,
  listStoredDocuments
} from '../utils/documentStorage';

interface SettingsScreenProps {
  settings: UserSettings;
  onUpdateSettings: (updater: (prev: UserSettings) => UserSettings) => void;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  /** Lets the library list refresh after the storage folder changes underneath it. */
  onStorageChanged?: () => void;
}

// Curated harmonious color palettes for active themes
export const THEME_COLOR_PALETTES = {
  mindful: [
    { name: 'Warm Terracotta', hex: '#e06d53' },
    { name: 'Golden Ochre', hex: '#d97706' },
    { name: 'Sage Leaf', hex: '#52796f' },
    { name: 'Deep Spruce', hex: '#2d6a4f' },
    { name: 'Oxford Slate', hex: '#3b5a70' },
    { name: 'Plum Velvet', hex: '#7209b7' },
    { name: 'Cedar Red', hex: '#bc4749' },
    { name: 'Dusty Indigo', hex: '#5e60ce' },
  ],
  vibrant: [
    { name: 'Rose Blossom', hex: '#f43f5e' },
    { name: 'Sky Azure', hex: '#0284c7' },
    { name: 'Emerald Forest', hex: '#059669' },
    { name: 'Royal Violet', hex: '#7c3aed' },
    { name: 'Amber Sun', hex: '#d97706' },
    { name: 'Teal Ocean', hex: '#0d9488' },
    { name: 'Crimson Wine', hex: '#be123c' },
    { name: 'Iris Blue', hex: '#4f46e5' },
  ],
  soft: [
    { name: 'Soft Coral', hex: '#f87171' },
    { name: 'Mint Herb', hex: '#4ade80' },
    { name: 'Sky Blue', hex: '#38bdf8' },
    { name: 'Lilac Bloom', hex: '#c084fc' },
    { name: 'Buttercup', hex: '#fbbf24' },
    { name: 'Peach Blush', hex: '#fb923c' },
    { name: 'Seafoam Teal', hex: '#2dd4bf' },
    { name: 'Lavender', hex: '#a78bfa' },
  ]
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  onUpdateSettings,
  onNavigate,
  isDark = false,
  onStorageChanged
}) => {
  const bridge = desktopBridge();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [libraryStats, setLibraryStats] = useState<{ count: number; bytes: number } | null>(null);
  const [isChangingFolder, setIsChangingFolder] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);

  const loadStorage = useCallback(async () => {
    const [info, documents] = await Promise.all([fetchStorageInfo(), listStoredDocuments()]);
    setStorage(info);
    setLibraryStats({
      count: documents.length,
      bytes: documents.reduce((total, d) => total + (d.originalBytes || 0), 0)
    });
  }, []);

  useEffect(() => {
    void loadStorage();
    void bridge?.getAppInfo().then(setAppInfo);
    // `bridge` is a stable object from the preload script, so this runs once per mount.
  }, [loadStorage, bridge]);

  // ── Auto-update ──────────────────────────────────────────────────────────
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });

  useEffect(() => {
    if (!bridge) return;
    void bridge.getAutoUpdatePreference().then(setAutoUpdateEnabled);
    return bridge.onUpdateStatus(setUpdateStatus);
  }, [bridge]);

  const handleToggleAutoUpdate = () => {
    if (!bridge) return;
    const next = !autoUpdateEnabled;
    setAutoUpdateEnabled(next);
    void bridge.setAutoUpdatePreference(next);
  };

  const handleCheckForUpdates = () => {
    if (!bridge) return;
    setUpdateStatus({ state: 'checking' });
    void bridge.checkForUpdates();
  };

  const handleChangeFolder = async () => {
    if (!bridge) return;
    setIsChangingFolder(true);
    setStorageNotice(null);
    try {
      const result = await bridge.chooseStorageDir();
      if (result.changed) {
        await loadStorage();
        onStorageChanged?.();
        setStorageNotice(
          result.moved
            ? `Moved ${result.moved} file${result.moved === 1 ? '' : 's'} to the new folder.`
            : 'Storage folder changed.'
        );
      }
    } finally {
      setIsChangingFolder(false);
    }
  };

  const handleResetFolder = async () => {
    if (!bridge) return;
    setIsChangingFolder(true);
    try {
      const result = await bridge.resetStorageDir();
      if (result.changed) {
        await loadStorage();
        onStorageChanged?.();
        setStorageNotice('Storage folder restored to the default location.');
      }
    } finally {
      setIsChangingFolder(false);
    }
  };

  const [isAddingTheme, setIsAddingTheme] = useState(false);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [newThemeName, setNewThemeName] = useState('');
  const [newThemeColor, setNewThemeColor] = useState('#52796f');
  const [selectedPaletteTab, setSelectedPaletteTab] = useState<'mindful' | 'vibrant' | 'soft'>('mindful');

  const handleAddTheme = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newThemeName.trim()) return;
    onUpdateSettings((prev) => ({
      ...prev,
      activeThemes: [
        ...prev.activeThemes,
        {
          id: Date.now().toString(),
          name: newThemeName.trim(),
          color: newThemeColor
        }
      ]
    }));
    setNewThemeName('');
    setIsAddingTheme(false);
  };

  const handleUpdateThemeColor = (id: string, color: string) => {
    onUpdateSettings((prev) => ({
      ...prev,
      activeThemes: prev.activeThemes.map((t) =>
        t.id === id ? { ...t, color } : t
      )
    }));
    setEditingThemeId(null);
  };

  const handleRemoveTheme = (id: string) => {
    onUpdateSettings((prev) => ({
      ...prev,
      activeThemes: prev.activeThemes.filter((t) => t.id !== id)
    }));
    if (editingThemeId === id) setEditingThemeId(null);
  };

  /**
   * The reader's own ink colours.
   *
   * Capped, because these are meant to be reachable in one press from a strip beside a mark —
   * a palette of thirty defeats the purpose and pushes the strip off the screen.
   */
  const MAX_CUSTOM_COLORS = 8;

  const handleAddCustomColor = () => {
    onUpdateSettings((prev) => {
      const existing = prev.customColors ?? [];
      if (existing.length >= MAX_CUSTOM_COLORS) return prev;
      // A distinct starting colour, so a newly added swatch is visibly its own rather than a
      // duplicate of the one beside it.
      const seed = ['#0ea5e9', '#f43f5e', '#84cc16', '#a855f7', '#f59e0b', '#14b8a6', '#6366f1', '#ec4899'];
      const next = seed.find((c) => !existing.includes(c)) ?? '#0ea5e9';
      return { ...prev, customColors: [...existing, next] };
    });
  };

  const handleUpdateCustomColor = (index: number, color: string) => {
    onUpdateSettings((prev) => ({
      ...prev,
      customColors: (prev.customColors ?? []).map((c, i) => (i === index ? color : c))
    }));
  };

  const handleRemoveCustomColor = (index: number) => {
    onUpdateSettings((prev) => ({
      ...prev,
      customColors: (prev.customColors ?? []).filter((_, i) => i !== index)
    }));
  };

  return (
    <main className="flex-1 px-5 py-4 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto w-full space-y-6">
      {/* Title */}
      <h2 className="font-serif text-[28px] font-semibold text-stone-900 dark:text-white">
        Settings
      </h2>

      {/* PROFILE — just the name that signs annotations. There is no account behind this. */}
      <section
        id="settings-profile-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-[#1b201d] border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase block mb-4">
          PROFILE
        </span>

        <div className="space-y-1.5">
          <label htmlFor="settings-name" className="text-[13px] font-medium text-stone-700 dark:text-stone-300">
            Your name
          </label>
          <input
            id="settings-name"
            type="text"
            value={settings.name}
            onChange={(e) => onUpdateSettings((p) => ({ ...p, name: e.target.value }))}
            placeholder="Reader"
            className={`w-full border rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
              isDark
                ? 'bg-[#272f2c] border-stone-700/80 text-white placeholder-stone-500'
                : 'bg-stone-50 border-stone-300/80 text-stone-900 placeholder-stone-400'
            }`}
          />
          <p className="text-[12px] text-stone-500 dark:text-stone-400 leading-snug">
            Signs the notes and annotations you write. Stays on this computer.
          </p>
        </div>
      </section>

      {/* STORAGE — where documents actually live on disk. */}
      <section
        id="settings-storage-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-[#1b201d] border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-1.5 mb-4">
          <HardDrive className="w-3.5 h-3.5 text-stone-500" />
          <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
            STORAGE
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-[12px] text-stone-500 dark:text-stone-400 block mb-1">
              Documents folder
            </span>
            <p
              className={`text-[12.5px] font-mono break-all leading-snug rounded-xl px-3 py-2.5 ${
                isDark ? 'bg-[#151917] text-stone-300' : 'bg-stone-50 text-stone-700'
              }`}
              title={storage?.location}
            >
              {storage?.location || 'Locating…'}
            </p>
          </div>

          {libraryStats && (
            <p className="text-[12px] text-stone-500 dark:text-stone-400">
              {libraryStats.count} document{libraryStats.count === 1 ? '' : 's'} ·{' '}
              {formatBytes(libraryStats.bytes)} of original files
            </p>
          )}

          {storageNotice && (
            <p className="text-[12px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 shrink-0" />
              {storageNotice}
            </p>
          )}

          {bridge ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleChangeFolder()}
                disabled={isChangingFolder}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#435c52] hover:bg-[#374c43] text-white text-[12.5px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {isChangingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
                <span>Change Folder…</span>
              </button>
              <button
                type="button"
                onClick={() => void bridge.revealStorageDir()}
                className="px-3.5 py-2 rounded-xl bg-stone-200/80 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 text-[12.5px] font-semibold transition-colors cursor-pointer"
              >
                Show in {appInfo?.platform === 'darwin' ? 'Finder' : 'File Explorer'}
              </button>
              {appInfo && storage && storage.location !== appInfo.defaultStorageDir && (
                <button
                  type="button"
                  onClick={() => void handleResetFolder()}
                  disabled={isChangingFolder}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 text-[12.5px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Use Default</span>
                </button>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-stone-500 dark:text-stone-400 leading-snug flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Choosing a folder needs the installed app. Set MARGINALIA_STORE_DIR to change it
                here.
              </span>
            </p>
          )}

          {/*
            Precise about the one exception. Storage really is local, but "nothing is sent
            anywhere" was not true of the whole app: Run AI Analysis posts the document's text to
            Google's Gemini API. Saying so here, next to the storage promise, is the honest place
            for it — a privacy claim that quietly excludes a feature is worse than no claim.
          */}
          <p className="text-[12px] text-stone-500 dark:text-stone-400 leading-snug pt-1 border-t border-stone-200 dark:border-stone-700/50">
            Everything — documents, their original files and your annotations — is kept in this
            folder on this computer, and reading and annotating never leave it. The one exception
            is <span className="font-semibold">Run AI Analysis</span>, which sends the document's
            text to Google's Gemini API to extract themes. Leave it unused and nothing goes out.
            {storage && storage.retentionDays > 0 && (
              <> Documents are deleted automatically after {storage.retentionDays} days.</>
            )}
          </p>
        </div>
      </section>

      {/* READING PREFERENCES Section */}
      <section
        id="settings-reading-preferences-section"
        className={`p-5 rounded-2xl border transition-all space-y-5 ${
          isDark
            ? 'bg-[#1b201d] border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase block">
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
              className={`w-full border rounded-xl px-4 py-3 text-[14px] appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
                isDark
                  ? 'bg-[#272f2c] border-stone-700/80 text-white'
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

        {/* Font Size Slider */}
        <div className="space-y-2 pt-1 border-t border-stone-200 dark:border-stone-700/50">
          <div className="flex justify-between items-center text-[13px]">
            <span className="text-stone-700 dark:text-stone-300 font-medium">Font Size</span>
            <span className="text-stone-500 dark:text-stone-400">{settings.fontSize}px</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-stone-500 font-serif text-[12px]">TT</span>
            <input
              type="range"
              min={14}
              max={26}
              value={settings.fontSize}
              onChange={(e) => onUpdateSettings((p) => ({ ...p, fontSize: Number(e.target.value) }))}
              className="flex-1 accent-[#435c52] h-1.5 bg-stone-200 dark:bg-stone-700 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-stone-700 dark:text-stone-400 font-serif text-[18px] font-semibold">TT</span>
          </div>
        </div>

        {/* Dark Mode Toggle */}
        <div className="flex items-center justify-between pt-3 border-t border-stone-200 dark:border-stone-700/50">
          <div className="max-w-60">
            <h4 className="text-[13px] font-medium text-stone-900 dark:text-white">Dark Mode</h4>
            <p className="text-[12px] text-stone-500 dark:text-stone-400 leading-snug">
              Switch to a darker theme for low-light environments
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.darkMode}
            onClick={() => onUpdateSettings((p) => ({ ...p, darkMode: !p.darkMode }))}
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
              settings.darkMode ? 'bg-[#435c52]' : 'bg-stone-300 dark:bg-stone-700'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                settings.darkMode ? 'right-0.5' : 'left-0.5'
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
            ? 'bg-[#1b201d] border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Droplet className="w-3.5 h-3.5 text-stone-500" />
            <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
              YOUR COLOURS
            </span>
          </div>
          <button
            type="button"
            onClick={handleAddCustomColor}
            disabled={(settings.customColors?.length ?? 0) >= MAX_CUSTOM_COLORS}
            className="flex items-center gap-1 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer disabled:opacity-40 disabled:no-underline disabled:cursor-default"
          >
            <Plus className="w-3.5 h-3.5" />
            Add colour
          </button>
        </div>
        <p className="text-[12px] text-stone-500 dark:text-stone-400 mb-4">
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
                <span className="block mt-1 text-[10px] text-center tabular-nums text-stone-400 uppercase">
                  {color.replace('#', '')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 text-center">
            <p className="text-[12px] text-stone-500 dark:text-stone-400">
              No colours of your own yet. Add one and it will show up in every picker.
            </p>
          </div>
        )}
      </section>

      {/* ACTIVE THEMES Section */}
      <section
        id="settings-active-themes-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-[#1b201d] border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-stone-500" />
            <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
              ACTIVE THEMES
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsAddingTheme(true)}
            className="text-[12px] font-semibold text-[#435c52] dark:text-stone-300 hover:text-stone-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        {/* Theme Pills / List */}
        <div className="space-y-2.5">
          {settings.activeThemes.map((theme) => {
            const isEditingThis = editingThemeId === theme.id;
            return (
              <div
                key={theme.id}
                className={`p-2.5 rounded-xl border transition-all ${
                  isEditingThis
                    ? isDark
                      ? 'bg-[#232a26] border-[#52796f]'
                      : 'bg-[#f7f6f2] border-[#52796f]'
                    : isDark
                      ? 'bg-[#151917] border-stone-800/80 hover:border-stone-700'
                      : 'bg-stone-50 border-stone-200/80 hover:bg-stone-100/70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Clickable color dot to change color */}
                    <button
                      type="button"
                      onClick={() => setEditingThemeId(isEditingThis ? null : theme.id)}
                      className="group relative cursor-pointer"
                      title="Click to choose a new color"
                    >
                      <span
                        className="w-4 h-4 rounded-full shrink-0 block border border-black/10 transition-transform group-hover:scale-125 shadow-xs"
                        style={{ backgroundColor: theme.color }}
                      />
                    </button>
                    <div>
                      <span className="text-[14px] text-stone-800 dark:text-stone-200 font-medium block">
                        {theme.name}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingThemeId(isEditingThis ? null : theme.id)}
                      className="p-1 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
                      title="Change theme color"
                    >
                      <Palette className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveTheme(theme.id)}
                      className="p-1 rounded-lg text-stone-400 hover:text-red-500 transition-colors"
                      aria-label={`Remove ${theme.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Inline Color Palette Picker for existing theme */}
                {isEditingThis && (
                  <div className="mt-3 pt-3 border-t border-stone-200 dark:border-stone-700/60 space-y-2.5 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-[11px] text-stone-500">
                      <span className="font-semibold uppercase tracking-wider">Choose Theme Color</span>
                      <button
                        type="button"
                        onClick={() => setEditingThemeId(null)}
                        className="text-stone-400 hover:text-stone-700 dark:hover:text-white"
                      >
                        Done
                      </button>
                    </div>

                    {/* Palette category tabs */}
                    <div className="flex items-center gap-1 p-0.5 bg-black/5 dark:bg-white/5 rounded-lg text-[11px]">
                      {(['mindful', 'vibrant', 'soft'] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setSelectedPaletteTab(tab)}
                          className={`flex-1 py-1 rounded-md capitalize font-medium transition-all ${
                            selectedPaletteTab === tab
                              ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-white shadow-2xs font-semibold'
                              : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-300'
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    {/* Swatches grid */}
                    <div className="grid grid-cols-4 gap-2 pt-1">
                      {THEME_COLOR_PALETTES[selectedPaletteTab].map((c) => {
                        const isCurrent = theme.color.toLowerCase() === c.hex.toLowerCase();
                        return (
                          <button
                            key={c.hex}
                            type="button"
                            onClick={() => handleUpdateThemeColor(theme.id, c.hex)}
                            className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all cursor-pointer ${
                              isCurrent
                                ? 'border-[#435c52] bg-[#435c52]/10 ring-1 ring-[#435c52]'
                                : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                            }`}
                          >
                            <span
                              className="w-5 h-5 rounded-full shadow-xs flex items-center justify-center border border-black/10"
                              style={{ backgroundColor: c.hex }}
                            >
                              {isCurrent && <Check className="w-3 h-3 text-white drop-shadow-xs" />}
                            </span>
                            <span className="text-[9px] text-stone-600 dark:text-stone-300 truncate max-w-full font-medium">
                              {c.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add Theme Form with Palette Selection */}
        {isAddingTheme && (
          <form onSubmit={handleAddTheme} className="mt-4 pt-4 border-t border-stone-200 dark:border-stone-700/60 space-y-3.5 animate-in fade-in duration-150">
            <div>
              <label className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase block mb-1">
                New Theme Name
              </label>
              <input
                type="text"
                placeholder="e.g., Epistemological Models, Ethics..."
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
                className={`w-full border rounded-xl px-3.5 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
                  isDark
                    ? 'bg-[#272f2c] border-stone-700 text-white placeholder-stone-500'
                    : 'bg-stone-50 border-stone-300 text-stone-900 placeholder-stone-400'
                }`}
                autoFocus
                required
              />
            </div>

            {/* Choose from Color Palettes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
                  Select Theme Palette Color
                </label>
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                    style={{ backgroundColor: newThemeColor }}
                  />
                  <input
                    type="color"
                    value={newThemeColor}
                    onChange={(e) => setNewThemeColor(e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                    title="Custom color picker"
                  />
                </div>
              </div>

              {/* Palette category tabs */}
              <div className="flex items-center gap-1 p-0.5 bg-black/5 dark:bg-white/5 rounded-lg text-[11px]">
                {(['mindful', 'vibrant', 'soft'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSelectedPaletteTab(tab)}
                    className={`flex-1 py-1 rounded-md capitalize font-medium transition-all ${
                      selectedPaletteTab === tab
                        ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-white shadow-2xs font-semibold'
                        : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-300'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Color Swatches Grid */}
              <div className="grid grid-cols-4 gap-1.5">
                {THEME_COLOR_PALETTES[selectedPaletteTab].map((c) => {
                  const isSelected = newThemeColor.toLowerCase() === c.hex.toLowerCase();
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setNewThemeColor(c.hex)}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#435c52] bg-[#435c52]/10 ring-1 ring-[#435c52]'
                          : 'border-stone-200/60 dark:border-stone-800 bg-white/60 dark:bg-stone-800/40 hover:bg-stone-100 dark:hover:bg-stone-800'
                      }`}
                    >
                      <span
                        className="w-5 h-5 rounded-full shadow-xs flex items-center justify-center border border-black/10"
                        style={{ backgroundColor: c.hex }}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white drop-shadow-xs" />}
                      </span>
                      <span className="text-[9px] text-stone-700 dark:text-stone-300 truncate max-w-full font-medium">
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200 dark:border-stone-700/60">
              <button
                type="button"
                onClick={() => setIsAddingTheme(false)}
                className="px-3 py-1.5 text-[12px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-[#435c52] hover:bg-[#374c43] text-white font-semibold text-[12px] rounded-xl shadow-xs transition-colors flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Save Theme</span>
              </button>
            </div>
          </form>
        )}
      </section>

      {/* UPDATES — checks a GitHub release feed and installs in place; the library and every
          setting live outside the app's install directory, so a new build never touches them. */}
      {bridge && (
        <section
          id="settings-updates-section"
          className={`p-5 rounded-2xl border transition-all ${
            isDark
              ? 'bg-[#1b201d] border-stone-800 text-stone-100'
              : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-4">
            <DownloadCloud className="w-3.5 h-3.5 text-stone-500" />
            <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
              UPDATES
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="max-w-60">
              <h4 className="text-[13px] font-medium text-stone-900 dark:text-white">
                Check for updates automatically
              </h4>
              <p className="text-[12px] text-stone-500 dark:text-stone-400 leading-snug">
                Downloads a new version in the background and installs it the next time you quit.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoUpdateEnabled}
              onClick={handleToggleAutoUpdate}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                autoUpdateEnabled ? 'bg-[#435c52]' : 'bg-stone-300 dark:bg-stone-700'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                  autoUpdateEnabled ? 'right-0.5' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-stone-200 dark:border-stone-700/50 flex items-center justify-between gap-3">
            <div className="text-[12.5px] flex items-center gap-1.5 min-w-0">
              {updateStatus.state === 'checking' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-stone-400" />
                  <span className="text-stone-500 dark:text-stone-400">Checking for updates…</span>
                </>
              )}
              {updateStatus.state === 'not-available' && (
                <>
                  <Check className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                  <span className="text-stone-500 dark:text-stone-400">You're up to date.</span>
                </>
              )}
              {updateStatus.state === 'available' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-stone-400" />
                  <span className="text-stone-500 dark:text-stone-400">
                    Version {updateStatus.version} found — downloading…
                  </span>
                </>
              )}
              {updateStatus.state === 'downloading' && (
                <div className="w-full">
                  <span className="text-stone-500 dark:text-stone-400 block mb-1.5">
                    Downloading update… {updateStatus.percent}%
                  </span>
                  <div className="h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
                    <div
                      className="h-full bg-[#435c52] transition-all"
                      style={{ width: `${updateStatus.percent}%` }}
                    />
                  </div>
                </div>
              )}
              {updateStatus.state === 'downloaded' && (
                <>
                  <DownloadCloud className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                  <span className="text-stone-600 dark:text-stone-300">
                    Version {updateStatus.version} is ready to install.
                  </span>
                </>
              )}
              {updateStatus.state === 'error' && (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                  <span className="text-stone-500 dark:text-stone-400 truncate" title={updateStatus.message}>
                    Couldn't check for updates.
                  </span>
                </>
              )}
              {updateStatus.state === 'idle' && (
                <span className="text-stone-400 dark:text-stone-500">
                  {appInfo ? `Running version ${appInfo.version}.` : ''}
                </span>
              )}
            </div>

            {updateStatus.state === 'downloaded' ? (
              <button
                type="button"
                onClick={() => void bridge.quitAndInstallUpdate()}
                className="shrink-0 px-3.5 py-2 rounded-xl bg-[#435c52] hover:bg-[#374c43] text-white text-[12.5px] font-semibold transition-colors cursor-pointer"
              >
                Restart &amp; Update
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCheckForUpdates}
                disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
                className="shrink-0 px-3.5 py-2 rounded-xl bg-stone-200/80 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 text-[12.5px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                Check Now
              </button>
            )}
          </div>
        </section>
      )}

      {/* ABOUT — version and platform, the desktop equivalent of a footer. */}
      <section
        id="settings-about-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-[#1b201d] border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase block mb-3">
          ABOUT
        </span>
        <div className="space-y-1.5 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-stone-600 dark:text-stone-400">Marginalia</span>
            <span className="text-stone-500 tabular-nums">{appInfo ? `Version ${appInfo.version}` : '—'}</span>
          </div>
          {appInfo && (
            <div className="flex items-center justify-between">
              <span className="text-stone-600 dark:text-stone-400">Platform</span>
              <span className="text-stone-500">
                {appInfo.platform === 'darwin' ? 'macOS' : appInfo.platform === 'win32' ? 'Windows' : 'Linux'}
              </span>
            </div>
          )}
        </div>
        <p className="mt-4 pt-3 border-t border-stone-200 dark:border-stone-700/50 text-[11.5px] text-stone-400 dark:text-stone-500 italic leading-snug">
          For close readers,
          <br />
          Built with care by Shama Iqbal Hussain.
        </p>
      </section>
    </main>
  );
};
