---
task: Color-code thematic analysis highlights per theme, scope nav/scroll to the active theme, fix toolbar toggle + selection-clears-formatting bug, and anchor sticky notes next to their selection in matching color
completion_criteria:
  - Each theme in "EXTRACTED THEMES" has a distinct highlight color (not a single uniform yellow), inspired by physical book color-tabs (each category = its own color swatch)
  - The Inspection Panel's document preview shows the highlights for ALL themes at once, each in its own theme color
  - Tapping a theme card scrolls the preview to the FIRST instance of that theme's highlight
  - After tapping a theme card, the top-right nav pane (prev/next arrows + "X / Y" counter) cycles ONLY through that theme's own highlight instances, not all themes' mentions combined
  - Bottom floating toolbar buttons (Bold, Underline, Highlight, Comment) are toggleable — tapping an already-applied style on the current selection removes it instead of only ever adding
  - Making a new text selection (or tapping to select) never clears/resets formatting already applied elsewhere in the document
  - Adding a sticky note to a mid-paragraph selection positions the note in the right-hand margin at the vertical offset of that selection (not stacked in creation order or pinned to paragraph top)
  - Sticky notes keep the handwritten-style rendering already in place (font-handwriting)
  - A sticky note's color matches the highlight color of the selection it was created from
max_iterations: 12
---

## Requirements

### Context
Screenshot of the current Analysis → Inspection Panel view shows every AI-matched
passage rendered in a single uniform yellow highlight, regardless of which theme it
belongs to. A second reference image shows a physical book with color-coded page-edge
tabs — one distinct color per category (e.g. "sophisticated words", "character
development & relationship", "ancient history", "translation + language", "quotes",
"heart breaking") with a handwritten label under each swatch. That's the target visual
language for how themes should be distinguished in the document preview: each theme
gets its own color, consistently, everywhere it shows up (theme card accent, highlight
color in the preview, nav pane dot/badge, and any sticky note pinned from that theme).

Relevant current code: `src/components/DocumentInspectionPanel.tsx`
(`renderHighlightedText`, the mention-nav header with prev/next + "X / Y" counter,
the bottom floating format toolbar, and the margin annotation cards), and
`src/components/ThematicAnalysisScreen.tsx` (theme cards, `theme.color`, the
"EXTRACTED THEMES" list that already carries a per-theme `color` field from Gemini —
that color should be the single source of truth for the highlight color instead of a
hardcoded yellow).

### 1. Per-theme highlight coloring
- In the document preview, every passage matched to a theme (via
  `matchedParagraphIndices` / excerpt matching) must render in THAT theme's own
  `color`, not a shared yellow. Every theme visible in "EXTRACTED THEMES" needs its
  highlight color to be distinguishable from the others (reuse the palette already
  assigned per theme card; don't collapse multiple themes onto the same or
  near-identical color).
- The right-side preview, by default, should show the highlights for ALL themes at
  once (multi-color overlay across the whole document), so a reader can see every
  theme's footprint simultaneously — this is the current "show everything" behavior,
  it just needs real per-theme color instead of one flat color.

### 2. Theme-scoped navigation
- Tapping a theme card (in the left "EXTRACTED THEMES" list) opens/updates the
  Inspection Panel and:
  - Scrolls the preview to the FIRST paragraph/instance matching that theme.
  - Switches the top-right nav pane (prev/next chevrons + "N / M" counter) into a
    scoped mode where prev/next only step through THAT theme's own mention
    instances — e.g. selecting the theme rendered in blue should make nav step
    only across blue highlights, skipping instances belonging to other themes.
- The nav pane's counter (currently "2 / 4") should reflect the count of the
  active theme's own mentions, not a global total across all themes.

### 3. Formatting toolbar fixes
- The bottom floating toolbar (Bold / Underline / Highlight+color-picker / Comment)
  must be a proper toggle per format type: tapping a style that is already applied
  to the current selection should REMOVE it; tapping it again re-applies it. Right
  now it's effectively add-only / inconsistent.
- Bug: making a new text selection anywhere in the document currently appears to
  clear previously-applied formatting. Selecting text (to read it, to start a new
  highlight, to open the toolbar) must never mutate or drop existing formatting
  elsewhere in the paragraph/document — formatting state should only change when
  the user explicitly taps a toolbar action.

### 4. Sticky note placement
- When a user selects a text span in the MIDDLE of a paragraph (not at the start)
  and adds a sticky note, the note card in the right margin column must be
  positioned at the vertical offset that corresponds to where that selection sits
  within the paragraph — i.e. visually "next to" the highlighted span — not
  appended to the bottom of the margin stack or pinned to the top of the
  paragraph. (There's partial support for this already via anchored offsets for
  hover-highlighting; the note's default resting position needs the same
  per-selection anchoring, not just its hover state.)
- Keep the existing handwritten note styling (font-handwriting, sticky-note card
  look).

### 5. Sticky note color coding
- A sticky note's background/border color must match the highlight color used for
  the selection it was created from (the theme color if pinned from a theme
  mention, or the user's chosen highlight color if created manually from the
  toolbar's color picker) — not a fixed default color independent of the
  highlight.
