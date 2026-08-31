/**
 * The thematic-analysis pipeline, extracted from `ThematicAnalysisScreen` so it can be driven
 * from anywhere.
 *
 * This exists because analysis moved from automatic to on-demand. It used to fire from a
 * `useEffect` the moment a document's text arrived, which meant every upload spent a model call
 * whether or not the reader wanted one, and there was no way to open a document just to read it.
 * The trigger is now `run()`, called by the workspace's "AI Analysis" button, and the same hook
 * backs the standalone analysis screen.
 *
 * Results are cached in `sessionStorage` per document title, so reopening a document shows its
 * previous analysis immediately instead of paying for it twice.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeInsight, MetaphorPattern, SymbolPattern, VocabularyTerm } from '../types';
import { analysisCacheKey } from '../utils/cacheKeys';
import { countThemeMentions, resolveThemeExcerpts, splitIntoParagraphs } from '../utils/themeMatching';

export interface ThematicAnalysisResult {
  themes: ThemeInsight[];
  metaphors: MetaphorPattern[];
  executiveSummary: string;
  synthesisQuote: string;
  symbols: SymbolPattern[];
  favoriteQuotes: string[];
  vocabulary: VocabularyTerm[];
  overallArgument: string;
  source: string;
}

const EMPTY_RESULT: ThematicAnalysisResult = {
  themes: [],
  metaphors: [],
  executiveSummary: '',
  synthesisQuote: '',
  symbols: [],
  favoriteQuotes: [],
  vocabulary: [],
  overallArgument: '',
  source: 'gemini-flash'
};

/**
 * Re-validates a cached analysis's excerpts against the document text. The server does this when
 * it generates an analysis, but a response cached before that existed can still hold excerpts the
 * model paraphrased — and since paraphrased excerpts match nothing, that theme would render with
 * no highlight and nothing to navigate to. Running the same resolver here lets an old cache entry
 * heal itself instead of silently degrading.
 */
function withResolvedExcerpts(extractedThemes: any[], text: string): ThemeInsight[] {
  if (!text.trim()) return extractedThemes;
  const paragraphs = splitIntoParagraphs(text);
  return extractedThemes.map((theme) => {
    const resolved = { ...theme, excerpts: resolveThemeExcerpts(theme, paragraphs) };
    return { ...resolved, mentions: countThemeMentions(resolved, text) };
  });
}

function normalize(data: any, text: string): ThematicAnalysisResult {
  return {
    themes: data.extractedThemes?.length ? withResolvedExcerpts(data.extractedThemes, text) : [],
    metaphors: data.metaphorPatterns || [],
    executiveSummary: data.executiveSummary || '',
    synthesisQuote: data.synthesisQuote || '',
    symbols: data.symbols || [],
    favoriteQuotes: data.favoriteQuotes || [],
    vocabulary: data.vocabulary || [],
    overallArgument: data.overallArgument || '',
    source: data.source || 'gemini-flash'
  };
}

function readCache(title: string, text: string): ThematicAnalysisResult | null {
  try {
    const raw = sessionStorage.getItem(analysisCacheKey(title));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.extractedThemes && !parsed.executiveSummary) return null;
    return normalize(parsed, text);
  } catch {
    return null;
  }
}

export interface UseThematicAnalysis extends ThematicAnalysisResult {
  isLoading: boolean;
  error: string | null;
  /** True once this document has an analysis, from cache or a fresh run. */
  hasAnalysis: boolean;
  /** Runs the analysis. Pass true to ignore the cache and re-analyze. */
  run: (forceReanalyze?: boolean) => Promise<void>;
}

export function useThematicAnalysis(documentTitle: string, documentText: string | undefined): UseThematicAnalysis {
  const [result, setResult] = useState<ThematicAnalysisResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a second run starting while one is in flight — the button is disabled during
  // a run, but a caller driving the hook programmatically has no such protection.
  const inFlightRef = useRef(false);

  // Show a cached analysis as soon as the document changes, without calling the model. This is
  // the only automatic behaviour left: it spends nothing and reopening a document with its
  // previous findings already on screen is what the reader expects.
  useEffect(() => {
    if (!documentTitle || !documentText?.trim()) {
      setResult(EMPTY_RESULT);
      return;
    }
    setResult(readCache(documentTitle, documentText) ?? EMPTY_RESULT);
    setError(null);
  }, [documentTitle, documentText]);

  const run = useCallback(
    async (forceReanalyze = false) => {
      const text = documentText || '';
      if (!text.trim() || inFlightRef.current) return;

      if (!forceReanalyze) {
        const cached = readCache(documentTitle, text);
        if (cached) {
          setResult(cached);
          return;
        }
      }

      inFlightRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/gemini/thematic-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: documentTitle, text })
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        const data = await res.json();
        if (data && (data.extractedThemes || data.executiveSummary)) {
          try {
            sessionStorage.setItem(analysisCacheKey(documentTitle), JSON.stringify(data));
          } catch {
            /* Cache is an optimisation; a full quota must not fail the analysis. */
          }
        }
        setResult(normalize(data, text));
      } catch (err) {
        console.warn('Thematic analysis failed:', err);
        setError('The analysis could not be completed. Check that a Gemini API key is configured, then try again.');
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [documentTitle, documentText]
  );

  return { ...result, isLoading, error, hasAnalysis: result.themes.length > 0 || Boolean(result.executiveSummary), run };
}
