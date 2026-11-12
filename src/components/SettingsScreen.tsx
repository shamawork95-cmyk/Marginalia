/**
 * Settings for the desktop app.
 *
 * Rewritten from the hosted-web version, which opened with an account card, an email address and
 * a "Free" subscription with a Manage button that did nothing. Marginalia has no accounts and no
 * server; those were props. What remains is the set of things that genuinely change how the app
 * behaves, plus the one control a desktop app owes its user and a web page cannot offer: saying
 * where on their own disk the documents live.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Sparkles, X, Check, Droplet, HardDrive, FolderOpen, Loader2, Info, RotateCcw, DownloadCloud, AlertTriangle, Scale, ExternalLink, Tag } from './icons';
import { Screen, TransitionType, UserSettings } from '../types';
import privacyText from '../../PRIVACY.md?raw';
import termsText from '../../TERMS.md?raw';
import { markManualUpdateCheck } from './UpdatePrompt';
import { ThemeManager } from './ThemeManager';
import { localThemeStore } from './themeStore';
import {
  AppInfo,
  StorageInfo,
  UpdateStatus,
  desktopBridge,
  fetchGeminiConfig,
  getAiEnabled,
  setAiEnabled,
  saveGeminiConfig,
  type GeminiConfig,
  fetchStorageInfo,
  listStoredDocuments
} from '../utils/documentStorage';
import { plural } from '../utils/plural';

interface SettingsScreenProps {
  settings: UserSettings;
  onUpdateSettings: (updater: (prev: UserSettings) => UserSettings) => void;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  /** Lets the library list refresh after the storage folder changes underneath it. */
  onStorageChanged?: () => void;
  /** Opens the What's New changelog modal. */
  onOpenChangelog?: () => void;
  /** Opens the first-run picture tour again. */
  onShowTutorial?: () => void;
}

/** Shown when the folder switched but main could not write it to config.json. */
const SAVE_FAILED_NOTICE =
  'Folder changed for this session, but the setting could not be saved; it will reset after restart.';

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
  onStorageChanged,
  onOpenChangelog,
  onShowTutorial
}) => {
  const bridge = desktopBridge();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [libraryStats, setLibraryStats] = useState<{ count: number; bytes: number } | null>(null);
  const [isChangingFolder, setIsChangingFolder] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);

  /**
   * The Gemini key, held only as a draft here.
   *
   * The saved key never travels back to the renderer — the status endpoint reports whether one is
   * set and which model will be used, and nothing more. There is no reason for the page to hold a
   * credential it only ever writes.
   */
  const [geminiConfig, setGeminiConfig] = useState<GeminiConfig | null>(null);
  const [geminiKeyDraft, setGeminiKeyDraft] = useState('');
  const [geminiModelDraft, setGeminiModelDraft] = useState('');
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [geminiSaved, setGeminiSaved] = useState(false);

  /** AI features are opt-in, off by default (kept in the desktop shell's config). */
  const [aiOn, setAiOn] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  useEffect(() => {
    void getAiEnabled().then(setAiOn);
  }, []);
  // Nothing about the key is asked for while AI is off.
  useEffect(() => {
    if (aiOn) void fetchGeminiConfig().then(setGeminiConfig);
  }, [aiOn]);
  const toggleAi = async () => {
    setAiSaving(true);
    setAiOn(await setAiEnabled(!aiOn));
    setAiSaving(false);
  };

  const persistGeminiConfig = useCallback(
    async (options?: { clear?: boolean }) => {
      setGeminiSaving(true);
      const update: { apiKey?: string; model?: string } = {};
      if (options?.clear) update.apiKey = '';
      else if (geminiKeyDraft.trim()) update.apiKey = geminiKeyDraft.trim();
      if (geminiModelDraft.trim()) update.model = geminiModelDraft.trim();
      const next = await saveGeminiConfig(update);
      if (next) setGeminiConfig(next);
      else setGeminiConfig(await fetchGeminiConfig());
      // The draft is dropped either way: leaving a key sitting in an input is exactly the habit
      // this field should not encourage.
      setGeminiKeyDraft('');
      setGeminiSaving(false);
      setGeminiSaved(true);
      window.setTimeout(() => setGeminiSaved(false), 2000);
    },
    [geminiKeyDraft, geminiModelDraft]
  );

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
    markManualUpdateCheck(bridge.checkForUpdates());
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
          result.error === 'config-save-failed'
            ? SAVE_FAILED_NOTICE
            : result.moved
            ? `Moved ${plural(result.moved, 'file')} to the new folder.`
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
        setStorageNotice(
          result.error === 'config-save-failed'
            ? SAVE_FAILED_NOTICE
            : 'Storage folder restored to the default location.'
        );
      }
    } finally {
      setIsChangingFolder(false);
    }
  };

  const [expandedLegalDoc, setExpandedLegalDoc] = useState<'privacy' | 'terms' | null>(null);

  const themeStore = useMemo(() => localThemeStore(settings.activeThemes, onUpdateSettings), [settings.activeThemes, onUpdateSettings]);

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
    <main className="font-serif flex-1 px-5 py-4 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto w-full space-y-6">
      {/* Title */}
      <h2 className="title-hand title-hand-rule text-[44px] text-stone-900 dark:text-paper">
        Settings
      </h2>

      {/* PROFILE — just the name that signs annotations. There is no account behind this. */}
      <section
        id="settings-profile-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-night-3 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <span className="caps spine-type text-muted block mb-4">
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
            className={`w-full border rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:ring-1 focus:ring-gold ${
              isDark
                ? 'bg-night-5 border-stone-700/80 text-paper placeholder-stone-500'
                : 'bg-stone-50 border-stone-300/80 text-stone-900 placeholder-stone-400'
            }`}
          />
          <p className="text-[12px] text-muted leading-snug">
            Signs the notes and annotations you write. Stays on this computer.
          </p>
        </div>
      </section>

      {/* AI FEATURES — optional and off by default; the key is asked for only once they are on. */}
      <section
        id="settings-ai-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-night-3 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-1.5 mb-4">
          <Sparkles className="w-3.5 h-3.5 text-muted" />
          <span className="caps spine-type text-muted">
            AI FEATURES (OPTIONAL)
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="max-w-prose">
            <h4 className="text-[13px] font-medium text-stone-900 dark:text-paper">AI features</h4>
            <p className="text-[12px] text-muted leading-snug">
              Off by default. Marginalia works fully without them, and nothing is sent anywhere.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aiOn}
            aria-label="AI features"
            disabled={aiSaving}
            onClick={() => void toggleAi()}
            className={`w-11 h-6 shrink-0 rounded-full transition-colors relative cursor-pointer disabled:opacity-60 ${
              aiOn ? 'bg-gold' : 'bg-stone-300 dark:bg-stone-700'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full shadow-xs absolute top-0.5 transition-transform ${
                aiOn ? 'right-0.5 bg-paper dark:bg-night' : 'left-0.5 bg-white dark:bg-stone-300'
              }`}
            />
          </button>
        </div>

        {aiOn && (
        <div className="space-y-3 pt-4 mt-4 border-t border-stone-200 dark:border-stone-700/50">
          <p className="text-[12.5px] text-stone-600 dark:text-stone-400 leading-relaxed max-w-prose">
            AI features need a Google Gemini key. It is stored on this computer, beside your
            library, and is sent to Google only when you press an AI button.{' '}
            Create a free one at{' '}
            <span className="spine-type text-[12px] text-stone-800 dark:text-stone-200">
              aistudio.google.com/apikey
            </span>
            .
          </p>

          <div className="flex items-center gap-2 text-[12px]">
            <span
              className={`w-2 h-2 rounded-full ${geminiConfig?.configured ? 'bg-gold' : 'bg-stone-300 dark:bg-stone-700'}`}
            />
            <span className="text-stone-600 dark:text-stone-400">
              {geminiConfig === null
                ? 'Checking…'
                : geminiConfig.configured
                  ? geminiConfig.source === 'environment'
                    ? 'A key is set in this device’s environment.'
                    : 'A key is saved on this computer.'
                  : 'No key set.'}
            </span>
          </div>

          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-stone-700 dark:text-stone-300">
              {geminiConfig?.configured ? 'Replace the key' : 'API key'}
            </span>
            <input
              type="password"
              value={geminiKeyDraft}
              onChange={(e) => setGeminiKeyDraft(e.target.value)}
              placeholder={geminiConfig?.configured ? '••••••••••••••••' : 'Paste your Gemini API key'}
              spellCheck={false}
              autoComplete="off"
              className={`w-full px-3 py-2 rounded-xl border text-[12.5px] spine-type focus:outline-none focus:ring-1 focus:ring-gold ${
                isDark
                  ? 'bg-night border-stone-800 text-stone-100'
                  : 'bg-white border-stone-200 text-stone-900'
              }`}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-stone-700 dark:text-stone-300">
              Model{' '}
              <span className="font-normal text-muted">
                (leave as it is unless a model is retired)
              </span>
            </span>
            <input
              type="text"
              value={geminiModelDraft}
              onChange={(e) => setGeminiModelDraft(e.target.value)}
              placeholder={geminiConfig?.model ?? 'gemini-flash-latest'}
              spellCheck={false}
              className={`w-full px-3 py-2 rounded-xl border text-[12.5px] spine-type focus:outline-none focus:ring-1 focus:ring-gold ${
                isDark
                  ? 'bg-night border-stone-800 text-stone-100'
                  : 'bg-white border-stone-200 text-stone-900'
              }`}
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void persistGeminiConfig()}
              disabled={geminiSaving || (!geminiKeyDraft.trim() && !geminiModelDraft.trim())}
              className="px-4 py-2 rounded-full bg-accent caps spine-type hover:bg-accent-hover text-on-accent text-[12.5px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default transition-colors"
            >
              {geminiSaving ? 'Saving…' : 'Save'}
            </button>
            {geminiConfig?.source === 'settings' && (
              <button
                type="button"
                onClick={() => void persistGeminiConfig({ clear: true })}
                disabled={geminiSaving}
                className="px-3 py-2 rounded-xl text-[12.5px] text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer transition-colors"
              >
                Remove key
              </button>
            )}
            {geminiSaved && <span className="text-[12px] text-gold dark:text-gold">Saved</span>}
          </div>
        </div>
        )}
      </section>

      {/* STORAGE — where documents actually live on disk. */}
      <section
        id="settings-storage-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-night-3 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-1.5 mb-4">
          <HardDrive className="w-3.5 h-3.5 text-muted" />
          <span className="caps spine-type text-muted">
            STORAGE
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-[12px] text-muted block mb-1">
              Documents folder
            </span>
            <p
              className={`text-[12.5px] spine-type break-all leading-snug rounded-xl px-3 py-2.5 ${
                isDark ? 'bg-night-1 text-stone-300' : 'bg-stone-50 text-stone-700'
              }`}
              title={storage?.location}
            >
              {storage?.location || 'Locating…'}
            </p>
          </div>

          {libraryStats && (
            <p className="text-[12px] text-muted">
              {plural(libraryStats.count, 'document')} ·{' '}
              {formatBytes(libraryStats.bytes)} of original files
            </p>
          )}

          {storageNotice && (
            <p className="text-[12px] text-gold dark:text-gold flex items-center gap-1.5">
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
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-accent caps spine-type hover:bg-accent-hover text-on-accent text-[12.5px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
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
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-muted hover:text-stone-800 dark:hover:text-stone-200 text-[12.5px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Use Default</span>
                </button>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-muted leading-snug flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Choosing a folder needs the installed app. Set MARGINALIA_STORE_DIR to change it
                here.
              </span>
            </p>
          )}

          <p className="text-[12px] text-muted leading-snug pt-1 border-t border-stone-200 dark:border-stone-700/50">
            Everything — documents, their original files and your annotations — is kept in this
            folder on this computer. Reading, annotating and tagging never leave it.
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
            ? 'bg-night-3 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <span className="caps spine-type text-muted block">
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
            <span className="caps spine-type text-muted">
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
          <span className="caps spine-type text-muted">
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
          <span className="text-[12.5px] spine-type tabular-nums text-muted uppercase">
            {settings.terminologyColor}
          </span>
        </div>
      </section>

      {/* THEMES: list, create, rename, recolour, delete (ThemeManager). */}
      <ThemeManager store={themeStore} isDark={isDark} />

      {/* UPDATES — checks a GitHub release feed and installs in place; the library and every
          setting live outside the app's install directory, so a new build never touches them. */}
      {bridge && (
        <section
          id="settings-updates-section"
          className={`p-5 rounded-2xl border transition-all ${
            isDark
              ? 'bg-night-3 border-stone-800 text-stone-100'
              : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-4">
            <DownloadCloud className="w-3.5 h-3.5 text-muted" />
            <span className="caps spine-type text-muted">
              UPDATES
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="max-w-60">
              <h4 className="text-[13px] font-medium text-stone-900 dark:text-paper">
                Check for updates automatically
              </h4>
              <p className="text-[12px] text-muted leading-snug">
                Downloads a new version in the background and installs it the next time you quit.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoUpdateEnabled}
              aria-label="Check for updates automatically"
              onClick={handleToggleAutoUpdate}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                autoUpdateEnabled ? 'bg-gold' : 'bg-stone-300 dark:bg-stone-700'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full shadow-xs absolute top-0.5 transition-transform ${
                  autoUpdateEnabled ? 'right-0.5 bg-paper dark:bg-night' : 'left-0.5 bg-white dark:bg-stone-300'
                }`}
              />
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-stone-200 dark:border-stone-700/50 flex items-center justify-between gap-3">
            <div className="text-[12.5px] flex items-center gap-1.5 min-w-0">
              {updateStatus.state === 'checking' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-stone-400" />
                  <span className="text-muted">Checking for updates…</span>
                </>
              )}
              {updateStatus.state === 'not-available' && (
                <>
                  <Check className="w-3.5 h-3.5 shrink-0 text-gold" />
                  <span className="text-muted">You're up to date.</span>
                </>
              )}
              {updateStatus.state === 'available' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-stone-400" />
                  <span className="text-muted">
                    Version {updateStatus.version} found — downloading…
                  </span>
                </>
              )}
              {updateStatus.state === 'downloading' && (
                <div className="w-full">
                  <span className="text-muted block mb-1.5">
                    Downloading update… {updateStatus.percent}%
                  </span>
                  <div className="h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
                    <div
                      className="h-full bg-gold transition-all"
                      style={{ width: `${updateStatus.percent}%` }}
                    />
                  </div>
                </div>
              )}
              {updateStatus.state === 'downloaded' && (
                <>
                  <DownloadCloud className="w-3.5 h-3.5 shrink-0 text-gold" />
                  <span className="text-stone-600 dark:text-stone-300">
                    Version {updateStatus.version} is ready to install.
                  </span>
                </>
              )}
              {updateStatus.state === 'error' && (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                  {/* The reason, not just the fact. This read "Couldn't check for updates." with
                      the real message hidden in a `title` — which this frameless window does not
                      reliably draw — so a release whose manifest pointed at a filename that was
                      not on it looked identical to being offline, and stayed unexplained. */}
                  <span className="text-muted line-clamp-2">
                    Update check failed{updateStatus.message ? `: ${updateStatus.message}` : '.'}
                  </span>
                </>
              )}
              {updateStatus.state === 'idle' && (
                <span className="text-muted">
                  {appInfo ? `Running version ${appInfo.version}.` : ''}
                </span>
              )}
            </div>

            {updateStatus.state === 'downloaded' ? (
              <button
                type="button"
                onClick={() => void bridge.quitAndInstallUpdate()}
                className="shrink-0 px-3.5 py-2 rounded-full bg-accent caps spine-type hover:bg-accent-hover text-on-accent text-[12.5px] font-semibold transition-colors cursor-pointer"
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
            ? 'bg-night-3 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <span className="caps spine-type text-muted block mb-3">
          ABOUT
        </span>
        <div className="space-y-1.5 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-stone-600 dark:text-stone-400">Marginalia</span>
            <div className="flex items-center gap-2">
              <span className="text-muted tabular-nums">{appInfo ? `Version ${appInfo.version}` : '—'}</span>
              {onOpenChangelog && (
                <button
                  type="button"
                  onClick={onOpenChangelog}
                  className="px-2 py-0.5 rounded-md text-[11px] spine-type font-medium bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 transition-colors cursor-pointer active:scale-95"
                >
                  What's New
                </button>
              )}

            </div>
          </div>
          {onShowTutorial && (
            <div className="flex items-center justify-between">
              <span className="text-stone-600 dark:text-stone-400">Picture tour</span>
              <button
                type="button"
                onClick={onShowTutorial}
                className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 transition-colors cursor-pointer active:scale-95"
              >
                Show tutorial
              </button>
            </div>
          )}
          {appInfo && (
            <div className="flex items-center justify-between">
              <span className="text-stone-600 dark:text-stone-400">Platform</span>
              <span className="text-muted">
                {appInfo.platform === 'darwin' ? 'macOS' : appInfo.platform === 'win32' ? 'Windows' : 'Linux'}
              </span>
            </div>
          )}
        </div>
        <p className="mt-4 pt-3 border-t border-stone-200 dark:border-stone-700/50 text-[11.5px] text-muted italic leading-snug">
          For close readers,
          <br />
          Built with care by Shama Iqbal Hussain.
        </p>
      </section>

      {/* LEGAL — the Privacy Policy and Terms (which also cover the app's name) ship with the
          app itself, so they're readable without a network connection or a web browser. */}
      <section
        id="settings-legal-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-night-3 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200/80 text-stone-900 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-1.5 mb-4">
          <Scale className="w-3.5 h-3.5 text-muted" />
          <span className="caps spine-type text-muted">
            LEGAL
          </span>
        </div>

        <div className="space-y-2">
          {(
            [
              { key: 'privacy' as const, label: 'Privacy Policy', text: privacyText },
              { key: 'terms' as const, label: 'Terms of Service', text: termsText }
            ]
          ).map(({ key, label, text }) => {
            const isOpen = expandedLegalDoc === key;
            return (
              <div
                key={key}
                className={`rounded-xl border overflow-hidden transition-all ${
                  isDark ? 'border-stone-800/80' : 'border-stone-200/80'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedLegalDoc(isOpen ? null : key)}
                  className="w-full flex items-center justify-between px-3.5 py-3 text-[13px] font-medium text-stone-800 dark:text-stone-200 cursor-pointer"
                >
                  <span>{label}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div
                    className={`px-3.5 pb-3.5 pt-1 max-h-72 overflow-y-auto text-[12px] leading-relaxed whitespace-pre-wrap border-t ${
                      isDark ? 'border-stone-800/80 text-stone-300' : 'border-stone-200/80 text-stone-600'
                    }`}
                  >
                    {text}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-stone-200 dark:border-stone-700/50">
          <a
            href="/legal/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[12px] font-semibold text-gold dark:text-stone-300 hover:underline cursor-pointer"
          >
            MIT License <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="/legal/THIRD_PARTY_NOTICES.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[12px] font-semibold text-gold dark:text-stone-300 hover:underline cursor-pointer"
          >
            Third-Party Notices <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <p className="mt-3 pt-3 border-t border-stone-200 dark:border-stone-700/50 text-[11.5px] text-muted leading-snug">
          "Marginalia" is the name of this app only — it is not affiliated with any other
          project or service that happens to share the name.
        </p>
      </section>
    </main>
  );
};
