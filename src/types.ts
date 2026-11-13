export type Screen =
  | 'home'
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
  /** ISO time the note was made. Newer notes only; export prefers it over `timestamp`. */
  createdAt?: string;
  /** References `UserSettings.activeThemes[].id`, or `null` when untagged. An id rather than a
   *  name so renaming a theme in Settings never orphans a note tagged with it. */
  themeIds: string[];
  quote?: string;
  /** Character offsets within the paragraph text, for notes anchored to a precise selection. */
  start?: number;
  end?: number;
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
  /**
   * The reader's own colours, offered everywhere a colour is chosen.
   *
   * Separate from `activeThemes` because the two mean different things: a theme is a category a
   * mark is FILED under, while these are just ink. Someone marking up a manuscript wants their
   * own greens and greys to hand without inventing a theme to justify each one.
   */
  customColors?: string[];
  /** Dismisses the Home screen's first-run callout prompting the reader to assign theme colours. */
  themeCtaDismissed?: boolean;
  /**
   * The single colour every terminology mark is drawn in, everywhere one appears.
   *
   * Unlike a theme's colour, this is never baked into the mark itself — `isTerminology` marks are
   * always rendered and exported by looking this setting up live, so changing it here instantly
   * recolours every terminology mark ever made, old and new alike, with no per-mark migration.
   */
  terminologyColor: string;
  /** Which of the Home screen's collapsible sections (Key Concepts, Terminologies, Themes) the
   *  reader has folded shut. Absent or false means expanded, so a fresh install shows everything. */
  collapsedHomeSections?: Record<string, boolean>;
  /** Whether the desktop sidebar is collapsed to icons-only. */
  sidebarCollapsed?: boolean;
  /** The text reader's two-page spread (on wide windows), kept across launches. */
  readerSpread?: boolean;
  /**
   * The app version whose changelog this reader has already seen.
   *
   * Kept here, with the durable settings, rather than in localStorage: the desktop build's
   * embedded server binds a fresh port every launch, and a different port is a different origin,
   * so anything in localStorage is gone by the next start. A "seen" flag kept there is never
   * seen again — the dialog simply reappears on every launch.
   */
  lastSeenVersion?: string;
  /** How Urdu, Persian and Arabic text is set in the reader and in exports. Absent means Nastaliq. */
  arabicScript?: 'nastaliq' | 'naskh';
  /** Poetry-aware reading, per text document id. Absent means prose. */
  poetry?: Record<string, PoetryPrefs>;
  /** Motifs the reader traces across My Collections: a name and the words that stand for it. */
  motifs?: Motif[];
}

/** One document's poetry view: numbering, radif and rhyme marks, and the metre the reader names. */
export interface PoetryPrefs {
  on: boolean;
  numbering: 'lines' | 'couplets';
  /** Underline the radif and the rhyme (qafiya). */
  prosody: boolean;
  /** The reader's own note of the metre (bahr), e.g. "hazaj musamman saalim". */
  metre?: string;
}

export interface Motif {
  id: string;
  name: string;
  /** Words or phrases, matched as whole words with their plurals (see utils/motifTrace). */
  terms: string[];
}

/** Where the reader is sent inside a text document: a passage to show, and words to paint there. */
export interface ReaderJump {
  paragraphIndex: number;
  /** Words painted wherever they occur (a traced motif). */
  terms?: string[];
  label?: string;
}

/**
 * What the reader asked to be shown when they opened a document from the library dashboard.
 *
 * Tapping a book under Key Concepts means "show me the key concepts in this book", not merely
 * "open this book" — so the request travels with the navigation and the workspace turns it into a
 * navigator over the matching marks. Carries its own label so the navigator can name what it is
 * stepping through without knowing where the request came from.
 */
export type AnnotationFocus =
  | { kind: 'theme'; themeId: string; label: string; color: string }
  | { kind: 'terminology'; label: string; color: string };
