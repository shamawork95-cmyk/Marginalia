import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  CheckCircle2, 
  Circle, 
  Globe, 
  Quote, 
  ChevronRight, 
  BookOpen, 
  RefreshCw, 
  Zap, 
  Bot, 
  Layers, 
  Lightbulb, 
  Info,
  Share2,
  ExternalLink,
  FileText
} from 'lucide-react';
import { Screen, TransitionType, ThemeInsight, MetaphorPattern, StickyNote } from '../types';
import { DocumentInspectionPanel } from './DocumentInspectionPanel';
import { CustomFormat, SymbolPattern, VocabularyTerm } from '../utils/documentExporter';
import { analysisCacheKey } from '../utils/cacheKeys';
import { countThemeMentions } from '../utils/themeMatching';
import { AnalysisSkeleton } from './SkeletonLoaders';

interface ThematicAnalysisScreenProps {
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  documentTitle?: string;
  documentText?: string;
  /** True when the source upload was a real PDF, whose paragraph chunks are native PDF pages rather than prose paragraphs. */
  isPdfSource?: boolean;
  notes: StickyNote[];
  onNotesChange: (updater: (prev: StickyNote[]) => StickyNote[]) => void;
  formats: CustomFormat[];
  onFormatsChange: (updater: (prev: CustomFormat[]) => CustomFormat[]) => void;
  authorName?: string;
}

/**
 * Client-side fallback for a theme's mention count. The backend now overrides `mentions`
 * with the true, exact match count right after generating the analysis, so this only
 * matters for analyses cached before that fix — anything fresh already carries the
 * correct number straight from the server.
 */
function calculateActualMentionCount(theme: any, documentText?: string): number {
  if (typeof theme.mentions === 'number' && theme.mentions > 0) return theme.mentions;
  if (!documentText || !documentText.trim()) return theme.mentions || 1;
  return countThemeMentions(
    { title: theme.title || theme.name, excerpts: theme.excerpts, keyQuote: theme.keyQuote || theme.description || theme.rationale },
    documentText
  );
}

export const ThematicAnalysisScreen: React.FC<ThematicAnalysisScreenProps> = ({
  onNavigate,
  isDark = false,
  documentTitle = '',
  documentText,
  isPdfSource = false,
  notes,
  onNotesChange,
  formats,
  onFormatsChange,
  authorName
}) => {
  const [themes, setThemes] = useState<ThemeInsight[]>([]);
  const [metaphors, setMetaphors] = useState<MetaphorPattern[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string>('');
  const [executiveSummary, setExecutiveSummary] = useState<string>('');
  const [synthesisQuote, setSynthesisQuote] = useState<string>('');
  const [symbols, setSymbols] = useState<SymbolPattern[]>([]);
  const [favoriteQuotes, setFavoriteQuotes] = useState<string[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabularyTerm[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [aiSource, setAiSource] = useState<string>('gemini-flash');

  // Preview Modal State
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  const openMentionPreview = (theme: any) => {
    setSelectedThemeId(theme.id || theme.name);
    setIsPreviewModalOpen(true);
  };

  // Trigger Gemini Flash Thematic Analysis
  const runGeminiAnalysis = async (forceReanalyze = false) => {
    const textToAnalyze = documentText || '';
    if (!textToAnalyze.trim()) return;
    
    const cacheKey = analysisCacheKey(documentTitle);
    
    if (!forceReanalyze) {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.extractedThemes) {
            setThemes(parsed.extractedThemes);
            if (parsed.extractedThemes.length > 0) {
              setSelectedThemeId(parsed.extractedThemes[0].id);
            }
            if (parsed.metaphorPatterns) setMetaphors(parsed.metaphorPatterns);
            if (parsed.executiveSummary) setExecutiveSummary(parsed.executiveSummary);
            if (parsed.synthesisQuote) setSynthesisQuote(parsed.synthesisQuote);
            setSymbols(parsed.symbols || []);
            setFavoriteQuotes(parsed.favoriteQuotes || []);
            setVocabulary(parsed.vocabulary || []);
            setAiSource(parsed.source || 'gemini-flash');
            return;
          }
        } catch (e) {
          console.warn('Failed to parse cached analysis', e);
        }
      }
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/gemini/thematic-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: documentTitle,
          text: textToAnalyze
        })
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      
      // Save successful response to cache
      if (data && (data.extractedThemes || data.executiveSummary)) {
        sessionStorage.setItem(cacheKey, JSON.stringify(data));
      }

      if (data.extractedThemes && data.extractedThemes.length > 0) {
        setThemes(data.extractedThemes);
        setSelectedThemeId(data.extractedThemes[0].id);
      }
      if (data.metaphorPatterns && data.metaphorPatterns.length > 0) {
        setMetaphors(data.metaphorPatterns);
      }
      if (data.executiveSummary) {
        setExecutiveSummary(data.executiveSummary);
      }
      if (data.synthesisQuote) {
        setSynthesisQuote(data.synthesisQuote);
      }
      setSymbols(data.symbols || []);
      setFavoriteQuotes(data.favoriteQuotes || []);
      setVocabulary(data.vocabulary || []);
      setAiSource(data.source || 'gemini-flash');
    } catch (err) {
      console.warn('Gemini Flash analysis fallback:', err);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Loads a CACHED analysis when the document changes — and nothing more.
   *
   * This used to call the model outright, so every document that appeared here spent a request
   * whether or not the reader wanted one, and opening a document just to read it was impossible.
   * Analysis is on demand now: the button below triggers it. Reading from the cache costs
   * nothing, so a document that has already been analysed still shows its findings immediately.
   */
  useEffect(() => {
    if (!documentText?.trim()) return;
    const cached = sessionStorage.getItem(analysisCacheKey(documentTitle));
    if (cached) runGeminiAnalysis(false);
  }, [documentText, documentTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTheme = (themes && themes.length > 0)
    ? (themes.find((t) => t.id === selectedThemeId) || themes[0])
    : undefined;

  const hasSplitView = Boolean(themes.length > 0 && documentText && documentText.trim().length > 0);

  return (
    <main className={`flex-1 flex w-full mx-auto h-full overflow-hidden transition-all duration-500 ease-out ${isPreviewModalOpen ? 'max-w-[1600px] lg:max-h-screen' : 'max-w-3xl'}`}>
      {/* Left Pane */}
      <div className={`w-full transition-all duration-500 ease-in-out ${isPreviewModalOpen ? 'lg:w-100 xl:w-112.5 shrink-0 border-r border-stone-200/60 dark:border-stone-800/60 lg:h-full lg:overflow-y-auto' : 'max-w-3xl mx-auto'} px-4 sm:px-6 py-4 pb-24 md:pb-8`}>
        <div className="space-y-8">
          {isLoading ? (
            <AnalysisSkeleton isDark={isDark} documentTitle={documentTitle} />
          ) : themes.length === 0 ? (
            <div className="p-8 rounded-3xl border border-dashed border-stone-300 dark:border-stone-800 text-center bg-stone-50/50 dark:bg-stone-900/30 space-y-4 my-8">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-serif text-[20px] font-bold text-stone-900 dark:text-white">
                  No Thematic Analysis Yet
                </h3>
                <p className="text-[13px] text-stone-600 dark:text-stone-400 max-w-sm mx-auto mt-1">
                  Upload a document or paste text to run AI thematic analysis.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('upload', 'push')}
                className="px-5 py-2.5 rounded-xl bg-[#435c52] text-white font-semibold text-[13px] hover:bg-[#374c43] transition-all cursor-pointer shadow-xs active:scale-[0.98]"
              >
                Upload Document to Analyze
              </button>
            </div>
          ) : (
            <>
      {/* Document Title & Meta Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold">
            <Zap className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span>AI Analysis</span>
          </div>

          <button
            type="button"
            onClick={() => runGeminiAnalysis(true)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-200/80 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 text-[12px] font-medium transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-600' : ''}`} />
            <span>{isLoading ? 'Synthesizing...' : 'Re-analyze'}</span>
          </button>
        </div>

        <h2 className="font-serif text-[26px] font-semibold leading-tight text-stone-900 dark:text-white">
          {documentTitle}
        </h2>
        
        {executiveSummary && (
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wider">AI Summary</div>
            <p className="text-[13px] text-stone-700 dark:text-stone-300 leading-relaxed italic bg-emerald-500/5 dark:bg-emerald-950/20 p-3.5 rounded-xl border border-emerald-500/20 dark:border-emerald-900/40">
              &ldquo;{executiveSummary}&rdquo;
            </p>
          </div>
        )}

        {/* Uploaded Document Name & Excerpt Summary Box */}
        <div className="p-4 rounded-2xl border border-stone-200/80 dark:border-stone-800 bg-white/80 dark:bg-stone-900/60 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1.5 rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-300 shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <span className="text-[13px] font-bold text-stone-900 dark:text-white truncate">
                {documentTitle}
              </span>
            </div>
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 shrink-0">
              {documentText ? `${documentText.split(/\s+/).filter(Boolean).length} words` : 'Parsed Document'}
            </span>
          </div>

          {documentText && (
            <p className="text-[12px] text-stone-600 dark:text-stone-400 line-clamp-3 leading-relaxed font-serif pt-1.5 border-t border-stone-100 dark:border-stone-800/60">
              {documentText.substring(0, 320)}...
            </p>
          )}
        </div>
      </div>

      {/* EXTRACTED THEMES Section */}
      <div className="space-y-3.5">
        <div className="flex items-center justify-between text-stone-600 dark:text-stone-300">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[11px] font-semibold tracking-wider uppercase">
              EXTRACTED THEMES ({themes.length})
            </span>
          </div>
          <span className="text-[11px] text-stone-500">Tap to inspect details</span>
        </div>

        {/* Theme Cards List */}
        <div className="space-y-3.5">
          {themes.map((theme) => {
            const isSelected = selectedThemeId === theme.id;
            const cardActualMentions = calculateActualMentionCount(theme, documentText);
            return (
              <div
                key={theme.id}
                id={`theme-card-${theme.id}`}
                onClick={() => {
                  setSelectedThemeId(theme.id);
                  setIsPreviewModalOpen(true);
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                  isSelected
                    ? isDark
                      ? 'bg-[#1b201d] border-emerald-500/40 shadow-md ring-1 ring-emerald-500/30'
                      : 'bg-white border-stone-300/80 shadow-xs ring-1 ring-stone-300/40'
                    : isDark
                      ? 'bg-[#151917] border-stone-800/80 opacity-80 hover:opacity-100'
                      : 'bg-white/70 border-stone-200 hover:bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h3 
                    className="font-serif text-[17px] font-semibold"
                    style={{ color: theme.color || '#8b5cf6' }}
                  >
                    {theme.title}
                  </h3>
                  {isSelected ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 fill-emerald-600/10 shrink-0" />
                  ) : (
                    <Circle className="w-5 h-5 text-stone-400 shrink-0" />
                  )}
                </div>

                <p className="text-[13px] text-stone-600 dark:text-stone-300 leading-relaxed mb-3">
                  {theme.description}
                </p>

                {/* Key Excerpt Mentions Box */}
                <div className="mt-3 pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2.5 text-[12px] animate-in fade-in duration-150">
                  <div
                    className={`p-3.5 rounded-2xl space-y-2.5 transition-all shadow-2xs ${
                      isDark ? 'bg-[#1b201d] border border-stone-800' : 'bg-stone-50 border border-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-semibold">
                      <span className="flex items-center gap-1.5 text-stone-700 dark:text-stone-300">
                        <Quote className="w-3.5 h-3.5" />
                        <span>Key Document Excerpts</span>
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                        {theme.excerpts?.length || 3} key quotes
                      </span>
                    </div>

                    {/* Render 2-3 Quote Snippets */}
                    <div className="space-y-1.5 pt-0.5">
                      {(theme.excerpts && theme.excerpts.length > 0
                        ? theme.excerpts.slice(0, 3)
                        : [theme.keyQuote || theme.description]
                      ).map((excerpt: string, qIdx: number) => (
                        <p
                          key={qIdx}
                          className="italic text-[12px] text-stone-700 dark:text-stone-300 leading-snug pl-2.5 border-l-2 border-stone-300 dark:border-stone-700"
                        >
                          &ldquo;{excerpt}&rdquo;
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[12px] pt-2 mt-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: theme.color || '#8b5cf6'
                      }}
                    />
                    <span className="text-stone-700 dark:text-stone-300 font-medium">
                      {theme.confidenceLabel || `${Math.round(theme.confidence > 1 ? theme.confidence : (theme.confidence || 0.9) * 100)}% Confidence`}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openMentionPreview(theme);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-700 dark:hover:text-emerald-300 text-stone-600 dark:text-stone-300 text-[11px] font-semibold transition-all active:scale-[0.96] shadow-2xs cursor-pointer"
                  >
                    <Quote className="w-3 h-3 text-stone-400" />
                    <span>{cardActualMentions} mentions</span>
                    <ExternalLink className="w-3 h-3 ml-0.5 opacity-60" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PATTERN FINDING: METAPHORS */}
      <section
        id="metaphors-pattern-section"
        className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-[#1b201d] border-stone-800 text-stone-100'
            : 'bg-[#f0eee9] border-stone-300/40 text-stone-900'
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-stone-700 dark:text-stone-300" />
            <span className="text-[11px] font-semibold tracking-wider text-stone-700 dark:text-stone-300 uppercase">
              PATTERN FINDING: METAPHORS
            </span>
          </div>
          <span className="text-[10px] uppercase font-bold text-stone-500 bg-stone-200/60 dark:bg-stone-800 px-2 py-0.5 rounded-md">
            AI
          </span>
        </div>

        {/* Metaphor Bars */}
        <div className="space-y-3 mb-5">
          {metaphors.map((item) => (
            <div
              key={item.name}
              onClick={() => openMentionPreview({ name: item.name, color: '#f59e0b', mentions: 5, excerpts: [item.name], rationale: item.rationale })}
              className="space-y-1 p-1.5 rounded-xl hover:bg-stone-200/40 dark:hover:bg-stone-800/50 transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="font-medium text-stone-700 dark:text-stone-300 w-28 shrink-0 flex items-center gap-1">
                  <span>{item.name}</span>
                  <ExternalLink className="w-3 h-3 opacity-40" />
                </span>
                <div className="flex-1 h-3 bg-stone-300/60 dark:bg-stone-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      item.name.toLowerCase().includes('watch')
                        ? 'bg-[#d8b4fe]'
                        : item.name.toLowerCase().includes('alpha')
                          ? 'bg-[#a7f3d0]'
                          : 'bg-amber-300'
                    }`}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
                <span className="text-[12px] font-semibold text-stone-600 dark:text-stone-400 w-9 text-right">
                  {item.percentage}%
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="h-px w-full bg-stone-300/70 dark:bg-stone-800 my-4" />

        {/* Quoted Synthesis Finding */}
        <p className="font-serif italic text-[13px] text-stone-700 dark:text-stone-300 leading-relaxed">
          &ldquo;{synthesisQuote}&rdquo;
        </p>

        {/* Jump to Reader Button */}
        <div className="mt-4 pt-1">
          <button
            type="button"
            onClick={() => onNavigate('reader', 'push')}
            className="w-full py-2.5 px-3 rounded-xl bg-[#435c52] hover:bg-[#374c43] text-white text-[13px] font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <BookOpen className="w-4 h-4" />
            <span>Read in Mindful Reader</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>
      </>
      )}
      </div>
      </div>
      
      {/* Right Pane (Desktop side-by-side) OR Mobile Overlay */}
      {isPreviewModalOpen && (
        <div className="lg:flex-1 lg:h-full lg:relative flex flex-col min-w-0 min-h-0 overflow-hidden">
          <DocumentInspectionPanel
            themes={themes as any}
            activeThemeId={selectedThemeId || (themes.length > 0 ? themes[0].id : '')}
            documentTitle={documentTitle}
            documentText={documentText}
            isPdfSource={isPdfSource}
            isDark={isDark}
            onClose={() => setIsPreviewModalOpen(false)}
            isDesktopSplit={hasSplitView && !isPreviewModalOpen}
            notes={notes}
            onNotesChange={onNotesChange}
            formats={formats}
            onFormatsChange={onFormatsChange}
            authorName={authorName}
            executiveSummary={executiveSummary}
            symbols={symbols}
            favoriteQuotes={favoriteQuotes}
            vocabulary={vocabulary}
          />
        </div>
      )}
    </main>
  );
};
