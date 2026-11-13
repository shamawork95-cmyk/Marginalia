/**
 * "Getting the most from Marginalia": the guide at the foot of My Collections (2.8.0).
 *
 * Every picture is a real screenshot of the app, made by `scripts/capture-guide.cjs` (run it after
 * changing anything shown here: `npm run guide:capture`). Each entry's `id` is its image's file
 * name in `src/assets/guide/`.
 */

export type GuideGroupId = 'reading' | 'marking' | 'notes' | 'themes' | 'finding' | 'exporting';

export interface GuideFeature {
  id: string;
  title: string;
  caption: string;
  /** A list of keys shown in place of a picture (the keyboard shortcuts card). */
  keys?: { keys: string; does: string }[];
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+';

/** The keys the app answers to, as the workspace and reader define them (workspaceKeys.ts, FocusMode, FindBar). */
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'H · U · S', does: 'Highlight, underline, strike out (PDF)' },
  { keys: 'A · P · N', does: 'Area highlight, pen, sticky note (PDF)' },
  { keys: 'V · E', does: 'Select, erase (PDF)' },
  { keys: '1 – 9', does: 'Pick a theme; over a selection or a selected mark, turn it on or off' },
  { keys: '← → · Page Up/Down', does: 'Turn the pages of a two-page spread' },
  { keys: `${MOD}F`, does: 'Find in the document' },
  { keys: 'F', does: 'Focus mode' },
  { keys: `${MOD}Z · ${MOD}Shift+Z`, does: 'Undo, redo (Ctrl+Y also redoes on Windows)' },
  { keys: 'Delete', does: 'Remove the selected mark' },
  { keys: 'Esc', does: 'Put the tool down, close a menu' }
];

export interface GuideGroup {
  id: GuideGroupId;
  title: string;
  features: GuideFeature[];
}

export const GUIDE_GROUPS: GuideGroup[] = [
  {
    id: 'reading',
    title: 'Reading',
    features: [
      { id: 'shelf', title: 'Your shelf', caption: 'Everything you add stands on My Readings, with how far you have read. Click a spine, then Read.' },
      { id: 'reader', title: 'A page to read and mark', caption: 'Text, EPUB, DOCX and pasted excerpts open in the reader, with your tools along the top.' },
      { id: 'spread', title: 'Two pages, turned like a book', caption: 'The open-book button shows two pages. Turn with the arrows at the edges, the arrow keys, or a sideways swipe.' },
      { id: 'poetry', title: 'Poetry view', caption: 'The feather button keeps a poem’s lines, numbers lines or shers, and underlines the radif and rhyme. Urdu reads right to left in Nastaliq.' },
      { id: 'pdfgrid', title: 'One, two, four or six PDF pages', caption: 'In a PDF, choose 1 page, 2 as a book, 4 or 6 in view, or Fit page. In 4 or 6, click a page to open it at reading size.' },
      { id: 'focus', title: 'Focus mode', caption: 'Press F (or the focus button) and everything but the page steps back. Esc brings it all back.' }
    ]
  },
  {
    id: 'marking',
    title: 'Marking',
    features: [
      { id: 'popover', title: 'Select words to mark them', caption: 'Select a passage and a menu appears: pick a theme, then highlight, underline, strike out, react, or write a sticky note.' },
      { id: 'overlap', title: 'One passage, several themes', caption: 'Turn on more than one theme in the selection menu, or mark the same words again under another theme: the mark is filed under each, with a small dot for every extra theme.' },
      { id: 'terminology', title: 'Terminology', caption: 'The tag button marks a term or piece of jargon, always in the terminology colour set in Settings, and gathers terms in My Margins Tracker.' },
      { id: 'pdftools', title: 'Drawing on a PDF', caption: 'Pen, shapes, arrows, brackets, sticky notes, text boxes and area highlights over figures and tables.' },
      { id: 'blackout', title: 'Black it out', caption: 'Hide words (select them), a box (drag it) or anything freehand. When you export, you can remove the hidden words from the PDF too.' },
      { id: 'links', title: 'Linked marks', caption: 'Link two marks that answer each other, even pages apart, and jump from one to the other.' },
      { id: 'shortcuts', title: 'Keyboard shortcuts', caption: 'The keys for the tools and moves you use most.', keys: SHORTCUTS }
    ]
  },
  {
    id: 'notes',
    title: 'Notes',
    features: [
      { id: 'margin', title: 'Notes in the margin', caption: 'A sticky note sits in the margin level with its line, and lights up the words it is about.' },
      { id: 'board', title: 'Excerpt board', caption: 'Pull marked passages onto a board, set them side by side, link them, and jump back to any one in the text.' }
    ]
  },
  {
    id: 'themes',
    title: 'Themes',
    features: [
      { id: 'tagging', title: 'File marks under a theme', caption: 'Choose a theme in the Tagging as strip (or press 1–9) and new marks take its colour. “+ New theme” in the selection menu makes one on the spot.' },
      { id: 'tracker', title: 'My Margins Tracker', caption: 'Key concepts, themes and terminology from every book, gathered on My Collections.' },
      { id: 'thememanager', title: 'Your themes', caption: 'Create, rename, recolour and delete themes in Settings.' }
    ]
  },
  {
    id: 'finding',
    title: 'Finding',
    features: [
      { id: 'find', title: 'Find in a document', caption: 'Ctrl+F (⌘F on a Mac) finds words in the open document and steps through each one.' },
      { id: 'search', title: 'Search everything', caption: 'Search looks through every document and every mark, note and theme in My Collections.' },
      { id: 'markspanel', title: 'The marks panel', caption: 'Every mark in the open document, grouped by theme, searchable and filtered by kind. Click one to go to it.' },
      { id: 'motif', title: 'Trace a motif', caption: 'Follow an image or idea across your collections. Each passage opens at its place with the words painted.' }
    ]
  },
  {
    id: 'exporting',
    title: 'Exporting',
    features: [
      { id: 'export', title: 'Export and the commonplace book', caption: 'Export a book’s marks as PDF, Markdown or text, or as a commonplace book: quotations by theme, cited and ready for an essay.' },
      { id: 'archive', title: 'Import and backups', caption: 'From Export: save your marks as Markdown or JSON, import marks from a JSON file, or restore one of the five automatic backups of your marks.' },
      { id: 'classpack', title: 'Class packs', caption: 'Save a document with your marks as one file for students. They open it from Add Document, with no account and no internet.' }
    ]
  }
];

/** Every feature's image name, in the order the capture script makes them. */
export const GUIDE_IMAGE_IDS = GUIDE_GROUPS.flatMap((g) => g.features.map((f) => f.id));
