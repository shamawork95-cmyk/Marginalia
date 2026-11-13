/**
 * Settings: updates (desktop only), About and the legal documents (moved verbatim from SettingsScreen).
 */

import React from 'react';
import {
  ChevronDown,
  Check,
  Loader2,
  DownloadCloud,
  AlertTriangle,
  Scale,
  ExternalLink
} from '../icons';
import privacyText from '../../../PRIVACY.md?raw';
import termsText from '../../../TERMS.md?raw';
import { AppInfo, UpdateStatus } from '../../utils/documentStorage';
import type { DesktopBridge } from '../../utils/documentStorage';

export interface SettingsAboutProps {
  appInfo: AppInfo;
  autoUpdateEnabled: boolean;
  bridge: DesktopBridge;
  expandedLegalDoc: "privacy" | "terms";
  handleCheckForUpdates: () => void;
  handleToggleAutoUpdate: () => void;
  isDark: boolean;
  onOpenChangelog: () => void;
  onShowTutorial: () => void;
  setExpandedLegalDoc: React.Dispatch<React.SetStateAction<"privacy" | "terms">>;
  updateStatus: UpdateStatus;
}

export const SettingsAbout: React.FC<SettingsAboutProps> = ({ appInfo, autoUpdateEnabled, bridge, expandedLegalDoc, handleCheckForUpdates, handleToggleAutoUpdate, isDark, onOpenChangelog, onShowTutorial, setExpandedLegalDoc, updateStatus }) => (
  <>
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
            <span className="caps font-spine text-muted">
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
                className="shrink-0 px-3.5 py-2 rounded-full bg-accent caps font-spine hover:bg-accent-hover text-on-accent text-[12.5px] font-semibold transition-colors cursor-pointer"
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
        <span className="caps font-spine text-muted block mb-3">
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
                  className="px-2 py-0.5 rounded-md text-[11px] font-spine font-medium bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 transition-colors cursor-pointer active:scale-95"
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
          <span className="caps font-spine text-muted">
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
  </>
);
