import React from 'react';
import { Zap, Sparkles, Globe, BookOpen, Upload, FileText, Clock, Settings } from 'lucide-react';

interface SkeletonProps {
  isDark?: boolean;
  documentTitle?: string;
}

/** Pulsing bar skeleton primitive */
const Bar: React.FC<{ w?: string; h?: string; className?: string }> = ({ w = 'w-full', h = 'h-4', className = '' }) => (
  <div className={`${h} ${w} rounded-md bg-stone-200 dark:bg-stone-800 animate-pulse ${className}`} />
);

// ─── Analysis Screen Skeleton ───
export const AnalysisSkeleton: React.FC<SkeletonProps> = ({ isDark = false, documentTitle }) => {
  return (
    <div className="w-full space-y-6">
      {/* Header Skeleton with Visible Document Title */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[12px] font-semibold">
            <Zap className="w-3.5 h-3.5 animate-bounce" />
            <span>AI Synthesizing...</span>
          </div>
          <Bar w="w-24" h="h-7" className="rounded-xl" />
        </div>

        {documentTitle ? (
          <h2 className="font-serif text-[22px] font-bold text-stone-900 dark:text-white leading-tight">
            {documentTitle}
          </h2>
        ) : (
          <Bar w="w-3/4" h="h-7" className="rounded-lg" />
        )}
        <div className="space-y-2 pt-1 animate-pulse">
          <Bar />
          <Bar w="w-5/6" />
        </div>
      </div>

      {/* Synthesis Quote Banner Skeleton */}
      <div
        className={`p-4 rounded-2xl border ${
          isDark ? 'bg-[#181c19] border-stone-800' : 'bg-[#f5f4ef] border-stone-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-emerald-500 animate-spin" />
          <Bar w="w-28" h="h-3" />
        </div>
        <Bar h="h-5" className="mb-2" />
        <Bar w="w-2/3" h="h-5" />
      </div>

      {/* Extracted Themes Section Skeleton */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Bar w="w-40" h="h-5" />
          <Bar w="w-24" h="h-3" />
        </div>

        <div className="space-y-3.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`p-4 rounded-2xl border ${
                isDark ? 'bg-[#151917] border-stone-800' : 'bg-white border-stone-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <Bar w="w-1/2" h="h-5" />
                <div className="h-5 w-5 rounded-full bg-stone-200 dark:bg-stone-800 animate-pulse" />
              </div>
              <div className="space-y-2 mb-3">
                <Bar h="h-3.5" />
                <Bar w="w-4/5" h="h-3.5" />
              </div>
              <div className="flex items-center justify-between pt-2">
                <Bar w="w-28" h="h-4" className="rounded-full" />
                <Bar w="w-20" h="h-4" className="rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Metaphor Bars Skeleton */}
      <div
        className={`p-5 rounded-2xl border space-y-4 ${
          isDark ? 'bg-[#1b201d] border-stone-800' : 'bg-[#f0eee9] border-stone-300/40'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-stone-400" />
            <Bar w="w-36" h="h-3.5" />
          </div>
          <Bar w="w-20" h="h-4" />
        </div>

        <div className="space-y-3">
          {[60, 35, 20].map((pct, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex justify-between">
                <Bar w="w-24" h="h-3.5" />
                <Bar w="w-8" h="h-3.5" />
              </div>
              <div className="h-3 w-full rounded-full bg-stone-200 dark:bg-stone-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500/40 animate-pulse"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status Ticker */}
      <div className="text-center pt-2">
        <p className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 animate-spin" />
          <span>Synthesizing themes, quotes & metaphors with AI...</span>
        </p>
      </div>
    </div>
  );
};

// ─── Settings Screen Skeleton ───
export const SettingsScreenSkeleton: React.FC<SkeletonProps> = ({ isDark = false }) => {
  return (
    <div className="px-5 py-4 max-w-md mx-auto md:max-w-2xl w-full space-y-6 animate-pulse">
      <Bar w="w-24" h="h-8" />

      {/* Account section */}
      <div className={`p-5 rounded-2xl border space-y-4 ${
        isDark ? 'bg-[#1b201d] border-stone-800' : 'bg-white border-stone-200/80'
      }`}>
        <Bar w="w-20" h="h-3" />
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-stone-200 dark:bg-stone-800" />
          <div className="space-y-1.5 flex-1">
            <Bar w="w-32" h="h-4" />
            <Bar w="w-48" h="h-3" />
          </div>
        </div>
      </div>

      {/* Preferences section */}
      <div className={`p-5 rounded-2xl border space-y-4 ${
        isDark ? 'bg-[#1b201d] border-stone-800' : 'bg-white border-stone-200/80'
      }`}>
        <Bar w="w-36" h="h-3" />
        <Bar h="h-10" className="rounded-xl" />
        <div className="flex justify-between">
          <Bar w="w-20" h="h-4" />
          <Bar w="w-12" h="h-4" />
        </div>
        <Bar h="h-2" className="rounded-full" />
        <div className="flex justify-between items-center pt-2">
          <Bar w="w-24" h="h-4" />
          <div className="w-11 h-6 rounded-full bg-stone-200 dark:bg-stone-800" />
        </div>
      </div>
    </div>
  );
};

// ─── Upload Screen Skeleton ───
export const UploadScreenSkeleton: React.FC<SkeletonProps> = ({ isDark = false }) => {
  return (
    <div className="px-5 py-4 max-w-md mx-auto md:max-w-2xl w-full space-y-6 animate-pulse">
      <div className="space-y-1">
        <Bar w="w-52" h="h-7" />
        <Bar w="w-72" h="h-3.5" />
      </div>

      {/* Dropzone skeleton */}
      <div className={`p-6 rounded-3xl border-2 border-dashed space-y-3 flex flex-col items-center ${
        isDark ? 'border-stone-700 bg-[#1b201d]' : 'border-stone-300 bg-stone-50/70'
      }`}>
        <div className="w-12 h-12 rounded-2xl bg-stone-200 dark:bg-stone-800" />
        <Bar w="w-40" h="h-5" />
        <Bar w="w-48" h="h-3" />
      </div>

      {/* Textarea skeleton */}
      <div className="space-y-2">
        <Bar w="w-28" h="h-3.5" />
        <div className={`h-24 rounded-2xl border ${
          isDark ? 'bg-[#181c19] border-stone-800' : 'bg-white border-stone-300/80'
        }`} />
      </div>

      {/* Recent docs skeleton */}
      <div className="space-y-3">
        <Bar w="w-32" h="h-4" />
        {[1, 2].map((i) => (
          <div key={i} className={`p-3.5 rounded-2xl border flex items-center gap-3 ${
            isDark ? 'bg-[#1b201d] border-stone-800' : 'bg-white border-stone-200/70'
          }`}>
            <div className="w-10 h-10 rounded-xl bg-stone-200 dark:bg-stone-800" />
            <div className="flex-1 space-y-1.5">
              <Bar w="w-2/3" h="h-3.5" />
              <Bar w="w-1/2" h="h-2.5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Legacy (keep backward compat) ───
export const HomeHeroSkeleton: React.FC<SkeletonProps> = ({ isDark = false }) => {
  return (
    <div
      className={`rounded-3xl p-6 border animate-pulse space-y-4 ${
        isDark ? 'bg-[#1b201d] border-stone-800' : 'bg-[#f0eee9] border-stone-300/60'
      }`}
    >
      <div className="flex justify-between">
        <Bar w="w-28" h="h-3.5" />
        <div className="h-8 w-8 rounded-xl bg-stone-300 dark:bg-stone-700" />
      </div>
      <Bar w="w-3/4" h="h-7" className="rounded-lg" />
      <Bar />
      <Bar h="h-11" className="rounded-xl pt-2" />
    </div>
  );
};
