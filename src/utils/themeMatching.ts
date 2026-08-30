/**
 * Shared, framework-agnostic text matching between AI-extracted themes and the source
 * document. Runs identically on the client (to render highlights and mention-preview
 * lists) and on the server (to compute a theme's true mention count right after the AI
 * response comes back, overriding its own guessed count) so both sides always agree on
 * the exact same set of matches.
 */

export interface MatchableTheme {
  id?: string;
  title?: string;
  color?: string;
  excerpts?: string[];
  keyQuote?: string;
  matchedParagraphIndices?: number[];
}

export interface ThemeInterval {
  start: number;
  end: number;
  color?: string;
  themeId?: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a case-insensitive regex for `phrase` that tolerates whitespace differences between
 * it and the document text — real PDF text extraction routinely inserts irregular whitespace
 * an AI-generated excerpt never has, not just between words ("were  benefiting") but even
 * mid-word from letter-spacing/kerning artifacts ("execu  tives", "e  one"). Allowing an
 * optional run of whitespace between every character (not just at real word boundaries) makes
 * the match robust to both, and matching directly against the ORIGINAL text (not a normalized
 * copy) means the found range's offsets still line up exactly with what gets highlighted.
 */
function buildFuzzyPhraseRegex(phrase: string): RegExp | null {
  const collapsed = phrase.trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;
  const tokens = Array.from(collapsed).map((ch) => (ch === ' ' ? '\\s+' : escapeRegExp(ch)));
  const pattern = tokens.join('\\s*');
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}

/** One sentence's character range within a paragraph. */
interface SentenceSpan {
  start: number;
  end: number;
  text: string;
}

/**
 * Splits a paragraph into sentence spans that keep their ORIGINAL character offsets, so a
 * sentence picked here can be highlighted at exactly the right place in the source text.
 */
export function splitIntoSentences(paraText: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const regex = /[^.!?\n]+[.!?]*[\s]*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(paraText)) !== null) {
    const raw = match[0];
    if (!raw.trim()) continue;
    // Trim trailing whitespace off the span so the highlight stops at the sentence's
    // last real character rather than bleeding into the gap before the next one.
    const trimmedEnd = raw.replace(/\s+$/, '').length;
    const leading = raw.length - raw.replace(/^\s+/, '').length;
    const start = match.index + leading;
    const end = match.index + trimmedEnd;
    if (end > start) spans.push({ start, end, text: paraText.slice(start, end) });
    if (raw.length === 0) regex.lastIndex += 1;
  }
  if (spans.length === 0 && paraText.trim()) {
    spans.push({ start: 0, end: paraText.length, text: paraText });
  }
  return spans;
}

/**
 * The distinct phrases a theme claims to be evidenced by — its excerpts and key quote, plus
 * any inner quoted fragment of either — longest first so the most specific phrase wins when
 * two overlap. The theme's own TITLE is deliberately NOT included: a title is a label the
 * model invented for the theme, not a passage from the document, and matching it turned every
 * incidental occurrence of a common title word into a "key excerpt".
 */
function collectThemePhrases(theme: MatchableTheme): string[] {
  const rawPhrases = [...(theme.excerpts || [])];
  if (theme.keyQuote) rawPhrases.push(theme.keyQuote);

  const phrasesToFind: string[] = [];
  rawPhrases.forEach((phrase) => {
    if (!phrase) return;
    const clean = phrase.replace(/["'\u201c\u201d\u2018\u2019]/g, '').trim();
    if (clean.length >= 3) phrasesToFind.push(clean);
    const matches = phrase.match(/['"\u201c]([^'"\u201d]+)['"\u201d]/g);
    if (matches) {
      matches.forEach((m) => {
        const sub = m.replace(/["'\u201c\u201d\u2018\u2019]/g, '').trim();
        if (sub.length >= 3) phrasesToFind.push(sub);
      });
    }
  });

  return Array.from(new Set(phrasesToFind))
    .filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length);
}

/** Every whitespace-tolerant occurrence of any of `phrases` within `paraText`. */
function findPhraseIntervals(paraText: string, phrases: string[]): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  phrases.forEach((phrase) => {
    const regex = buildFuzzyPhraseRegex(phrase);
    if (!regex) return;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(paraText)) !== null) {
      found.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  });
  return found;
}

/** Content words worth scoring a sentence against — short filler words are pure noise here. */
function significantWords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter((w) => w.length >= 4)
    )
  );
}

/**
 * The single sentence in `paraText` that best evidences `theme`, used ONLY when none of the
 * theme's own excerpts match this paragraph verbatim. Returning one sentence (rather than the
 * whole paragraph, which is what this replaced) keeps a highlight excerpt-sized even when the
 * model paraphrased its own evidence — the reader sees the specific claim the theme rests on,
 * not a wall of uniformly tinted text.
 */
function findBestSentenceInterval(paraText: string, theme: MatchableTheme): { start: number; end: number } | null {
  const sentences = splitIntoSentences(paraText);
  if (sentences.length === 0) return null;

  const themeWords = significantWords(
    [...(theme.excerpts || []), theme.keyQuote || '', theme.title || ''].join(' ')
  );
  if (themeWords.length === 0) return { start: sentences[0].start, end: sentences[0].end };

  let best: SentenceSpan | null = null;
  let bestScore = 0;
  sentences.forEach((sentence) => {
    const sentenceWords = new Set(significantWords(sentence.text));
    const overlap = themeWords.reduce((count, w) => count + (sentenceWords.has(w) ? 1 : 0), 0);
    // Normalize by sentence length so a long, rambling sentence doesn't out-score a short,
    // precisely on-topic one purely by containing more words.
    const score = overlap / Math.sqrt(Math.max(1, sentenceWords.size));
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  });

  const chosen: SentenceSpan = best || sentences[0];
  return { start: chosen.start, end: chosen.end };
}

/**
 * Locates every span in `paraText` that a theme's analysis actually evidences: exactly the
 * excerpt and key-quote phrases it cited, found whitespace-tolerantly in the text. Nothing
 * else — no whole-paragraph tinting, no theme-title word matching, no per-paragraph
 * consolation highlight.
 *
 * This used to treat `matchedParagraphIndices` as a highlight instruction and tint every
 * matched paragraph end-to-end, so a document the model claimed broadly came out almost
 * entirely colored and the reader lost any sense of which few passages were the real evidence.
 * Those indices are now only a scope hint, consumed upstream by `resolveThemeExcerpts`.
 *
 * The guarantee that a theme always has SOMETHING to highlight lives in `resolveThemeExcerpts`
 * instead: it runs once, server-side, and promotes a real sentence into a real excerpt when the
 * model's own citations don't appear in the text. Keeping the fallback there rather than here
 * matters — a per-paragraph fallback fires independently in each scoped paragraph, so a theme
 * that legitimately matched a short phrase in two paragraphs would still get a third paragraph
 * highlighted wholesale just for being listed.
 */
export function computeThemeIntervals(paraText: string, themes: MatchableTheme[], _pIdx?: number): ThemeInterval[] {
  const intervals: ThemeInterval[] = [];

  themes.forEach((theme) => {
    const phrases = collectThemePhrases(theme);
    findPhraseIntervals(paraText, phrases).forEach((hit) => {
      intervals.push({ start: hit.start, end: hit.end, color: theme.color, themeId: theme.id });
    });
  });

  return intervals;
}

/**
 * Rewrites a theme's `excerpts` so every one of them is a real, verbatim span of the document —
 * the exact spans the reader will see highlighted and step through with prev/next. Excerpts the
 * model paraphrased (and which therefore match nothing) are dropped; if that leaves the theme
 * with no evidence at all, the best sentence from each paragraph the model scoped it to is
 * promoted into an excerpt in their place.
 *
 * Running this server-side, once, means every downstream consumer — the reader's highlights,
 * the analysis screen's "key document excerpts" list, the mention counter, and the export —
 * all describe the exact same handful of passages instead of each deriving its own set.
 */
export function resolveThemeExcerpts(theme: MatchableTheme, paragraphs: string[], maxExcerpts = 6): string[] {
  const phrases = collectThemePhrases(theme);
  const verbatim: string[] = [];
  const seen = new Set<string>();

  const remember = (text: string) => {
    const trimmed = text.trim();
    const key = trimmed.toLowerCase();
    if (trimmed.length < 3 || seen.has(key)) return;
    seen.add(key);
    verbatim.push(trimmed);
  };

  /**
   * Drops any excerpt wholly contained in another. Models routinely cite both a full sentence
   * as the key quote AND a clause of that same sentence as an excerpt; both match the same
   * span, so keeping both would list one piece of evidence twice.
   */
  const dropNested = (list: string[]): string[] => {
    const byLength = [...list].sort((a, b) => b.length - a.length);
    const kept: string[] = [];
    byLength.forEach((candidate) => {
      const lower = candidate.toLowerCase();
      if (!kept.some((k) => k.toLowerCase().includes(lower))) kept.push(candidate);
    });
    // Restore the caller's original ordering so the longest excerpt doesn't always lead.
    return list.filter((item) => kept.includes(item));
  };

  // Keep the model's own excerpts, but stored as the text as it ACTUALLY appears in the
  // document (the matched span), not as the model typed it — so whitespace/quoting quirks
  // in its output can't make the same phrase fail to match somewhere else later.
  paragraphs.forEach((paraText) => {
    findPhraseIntervals(paraText, phrases).forEach((hit) => {
      remember(paraText.slice(hit.start, hit.end));
    });
  });

  if (verbatim.length > 0) return dropNested(verbatim).slice(0, maxExcerpts);

  const scopedIndices = (theme.matchedParagraphIndices || []).filter(
    (idx) => Number.isInteger(idx) && idx >= 0 && idx < paragraphs.length
  );
  const fallbackIndices = scopedIndices.length > 0 ? scopedIndices : paragraphs.length > 0 ? [0] : [];

  fallbackIndices.forEach((idx) => {
    const sentence = findBestSentenceInterval(paragraphs[idx], theme);
    if (sentence) remember(paragraphs[idx].slice(sentence.start, sentence.end));
  });

  return dropNested(verbatim).slice(0, maxExcerpts);
}

export function splitIntoParagraphs(documentText: string): string[] {
  return documentText
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export interface ThemeMention {
  paragraphIndex: number;
  start: number;
  end: number;
  quoteText: string;
}

/**
 * Every real, exact occurrence of a theme in the document — built from `computeThemeIntervals`,
 * the SAME strict character-position matching the reader actually sees highlighted in the
 * theme's color. Because that matcher now only ever returns excerpt-sized spans, one "mention"
 * is one key excerpt: stepping prev/next through them walks the reader through exactly the
 * handful of passages the theme is built on, and the mention count is that handful's size.
 */
export function findThemeMentions(paragraphs: string[], theme: MatchableTheme): ThemeMention[] {
  const mentions: ThemeMention[] = [];
  paragraphs.forEach((paraText, pIdx) => {
    const intervals = computeThemeIntervals(paraText, [theme], pIdx);
    if (intervals.length === 0) return;

    // Merge overlapping/adjacent intervals — an excerpt and the keyQuote can both match the
    // same phrase — so one real occurrence in the text isn't double-counted as two mentions.
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    sorted.forEach((iv) => {
      const last = merged[merged.length - 1];
      if (last && iv.start <= last.end) {
        last.end = Math.max(last.end, iv.end);
      } else {
        merged.push({ start: iv.start, end: iv.end });
      }
    });

    merged.forEach((m) => {
      mentions.push({ paragraphIndex: pIdx, start: m.start, end: m.end, quoteText: paraText.slice(m.start, m.end) });
    });
  });
  return mentions;
}

/**
 * How many key excerpts a theme actually has in the real document text — counted with the same
 * strict matching the UI uses to draw highlights, rather than the AI's own guessed `mentions`
 * integer (which is frequently off, since the model never re-counts its own excerpts against
 * the source). This is the number the reader's prev/next control steps through, so it must be
 * the real count and not a floor: a theme whose evidence didn't survive validation genuinely
 * has 0 excerpts, and claiming 1 would promise a mention there is nothing to navigate to.
 */
export function countThemeMentions(theme: MatchableTheme, documentText: string): number {
  if (!documentText || !documentText.trim()) return 0;
  const paragraphs = splitIntoParagraphs(documentText);
  return findThemeMentions(paragraphs, theme).length;
}

/**
 * Guarantees a theme has at least one real, valid paragraph to highlight and navigate to — a
 * server-side safety net for when the model doesn't fully comply with the (required, non-empty)
 * `matchedParagraphIndices` schema field. Without this, a theme with no valid anchor renders no
 * highlight anywhere, so "jump to this theme's mention" has nowhere real to land and either does
 * nothing or (with a looser matcher) lands on unhighlighted text — exactly the bug this exists to
 * prevent. Order of trust: the model's own indices (if in range) > exact/fuzzy text matches via
 * `findThemeMentions` > the single paragraph with the most word-overlap with the theme's own
 * title/excerpts/keyQuote, which — since it always returns something as long as there's at least
 * one paragraph — is the last resort that keeps this from ever coming back empty.
 */
export function resolveMatchedParagraphIndices(theme: MatchableTheme, paragraphs: string[]): number[] {
  const inRange = (theme.matchedParagraphIndices || []).filter(
    (idx) => Number.isInteger(idx) && idx >= 0 && idx < paragraphs.length
  );
  if (inRange.length > 0) return Array.from(new Set(inRange));

  const mentions = findThemeMentions(paragraphs, theme);
  if (mentions.length > 0) return Array.from(new Set(mentions.map((m) => m.paragraphIndex)));

  if (paragraphs.length === 0) return [];

  const words = Array.from(
    new Set(
      [theme.title || '', ...(theme.excerpts || []), theme.keyQuote || '']
        .join(' ')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4)
    )
  );
  if (words.length === 0) return [0];

  let bestIdx = 0;
  let bestScore = -1;
  paragraphs.forEach((p, idx) => {
    const lowerP = p.toLowerCase();
    const score = words.reduce((count, w) => count + (lowerP.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return [bestIdx];
}
