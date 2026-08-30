export type Screen =
  | 'home'
  | 'analysis'
  | 'settings'
  | 'upload'
  | 'reader'
  /** The PDF viewer and annotation editor. */
  | 'workspace';

export type TransitionType = 'push' | 'push_back' | 'slide_up' | 'none';

export interface Book {
  id: string;
  title: string;
  author: string;
  chapter?: string;
  currentPage?: number;
  totalPages?: number;
  progressPercent?: number;
  category: string;
  tagText: string;
  annotationsCount?: number;
  isNew?: boolean;
  coverGradient: string;
  coverImage?: string;
}

export interface StickyNote {
  id: string;
  paragraphIndex: number;
  /** Named palette color ('yellow' | 'purple' | 'teal' | 'rose') or an arbitrary hex string. */
  color: string;
  title: string;
  content: string;
  author: string;
  timestamp: string;
  themeTag?: string;
  quote?: string;
  isAiGenerated?: boolean;
  rationale?: string;
  confidence?: number;
  /** Character offsets within the paragraph text, for notes anchored to a precise selection. */
  start?: number;
  end?: number;
}

export interface AISuggestion {
  title: string;
  themeTag: string;
  quote?: string;
  content: string;
  color: 'yellow' | 'purple' | 'teal' | 'rose';
  confidence?: number;
  rationale?: string;
}

export interface ThemeInsight {
  id: string;
  title: string;
  description: string;
  confidence: number;
  confidenceLabel: string;
  mentions: number;
  selected?: boolean;
  color: string;
  excerpts?: string[];
  keyQuote?: string;
  matchedParagraphIndices?: number[];
}

/** A recurring symbol the analysis identified, with the meaning the model assigned it. */
export interface SymbolPattern {
  name: string;
  description: string;
}

/** A notable term from the document, with its definition in context. */
export interface VocabularyTerm {
  term: string;
  definition: string;
}

export interface MetaphorPattern {
  name: string;
  percentage: number;
  colorClass: string;
  /** The model's justification for the pattern, surfaced when a metaphor is inspected. */
  rationale?: string;
}

/**
 * Preferences for this installation, stored on the machine.
 *
 * No account fields: Marginalia runs entirely on the user's own computer with nothing behind it,
 * so `name` is simply what signs their notes. Where documents are stored is NOT here — that lives
 * on disk with the store itself, so the app can find the library before preferences are loaded.
 */
export interface UserSettings {
  /** Signs the reader's annotations and notes. */
  name: string;
  typography: string;
  fontSize: number;
  darkMode: boolean;
  /** Emphasises a distraction-free reading layout. */
  readerMode: boolean;
  activeThemes: { id: string; name: string; color: string }[];
}
