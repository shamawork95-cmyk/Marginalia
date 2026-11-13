import { jsPDF } from 'jspdf';
import { StickyNote } from '../types';
import { groupHeads, sortTextMarks, type TextMark, type TextMarkKind } from './textMarks';
import { plural } from './plural';

/** The global theme list, just enough of it to resolve an id to a display name. */
export type ThemeRef = { id: string; name: string };

export interface ExportOptions {
  bookTitle: string;
  bookAuthor: string;
  bookChapter?: string;
  /** A theme id, or 'All' — filtering is by id so a later rename doesn't silently break it. */
  themeFilter?: string;
  themes: ThemeRef[];
  format: 'pdf' | 'markdown' | 'txt';
  includeQuotes: boolean;
}

function themeName(themeId: string | null | undefined, themes: ThemeRef[]): string {
  return themes.find((t) => t.id === themeId)?.name || 'General';
}

/** Every theme an entry is filed under, main theme first: "Love, Ruin". "General" when none. */
export function themeNames(themeIds: readonly string[] | undefined, themes: ThemeRef[]): string {
  const names = (themeIds ?? []).map((id) => themes.find((t) => t.id === id)?.name).filter(Boolean);
  return names.length ? names.join(', ') : 'General';
}

/** "Theme" or, for a mark under several, "Themes". */
const themeLabelFor = (ids: readonly string[] | undefined) => ((ids?.length ?? 0) > 1 ? 'Themes' : 'Theme');

/**
 * Filter annotations based on user selection
 */
export function getFilteredAnnotations<T extends { themeIds: string[] }>(
  notes: T[],
  themeFilter: string = 'All'
): T[] {
  return notes.filter((note) => {
    // A mark under several themes is in each of their exports.
    if (themeFilter !== 'All' && !note.themeIds?.includes(themeFilter)) return false;
    return true;
  });
}

/**
 * Generate formatted plain text representation
 */
export function generatePlainText(notes: ExportEntry[], options: ExportOptions): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let output = `=================================================================\n`;
  output += `  MARGINALIA - ANNOTATIONS & MARGIN NOTES\n`;
  output += `=================================================================\n\n`;
  output += `Title:    ${options.bookTitle}\n`;
  if (options.bookAuthor) output += `Author:   ${options.bookAuthor}\n`;
  if (options.bookChapter) output += `Chapter:  ${options.bookChapter}\n`;
  output += `Exported: ${dateStr}\n`;
  output += `Total:    ${plural(notes.length, 'annotation')}\n`;
  output += `Theme:    ${!options.themeFilter || options.themeFilter === 'All' ? 'All' : themeName(options.themeFilter, options.themes)}\n\n`;
  output += `-----------------------------------------------------------------\n\n`;

  notes.forEach((note, idx) => {
    output += `${idx + 1}. ${note.title}\n`;
    output += `   ${themeLabelFor(note.themeIds).padEnd(10)} ${themeNames(note.themeIds, options.themes)}\n`;
    output += `   Author:    ${note.author || 'Reader'}\n`;
    const date = noteDateLabel(note);
    if (date) output += `   Date:      ${date}\n`;

    if (showsQuote(note, options)) {
      output += `\n   Passage Excerpt:\n`;
      output += `   "${note.quote}"\n`;
    }

    if (showsBody(note)) {
      output += `\n   Annotation Note:\n`;
      output += `   ${note.content}\n`;
    }

    output += `\n-----------------------------------------------------------------\n\n`;
  });

  return output;
}

/**
 * Generate structured Markdown representation
 */
export function generateMarkdown(notes: ExportEntry[], options: ExportOptions): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let md = `# Marginalia Notes: ${options.bookTitle}\n\n`;
  if (options.bookAuthor) md += `**Author:** ${options.bookAuthor}  \n`;
  if (options.bookChapter) md += `**Chapter:** ${options.bookChapter}  \n`;
  md += `**Export Date:** ${dateStr}  \n`;
  md += `**Total Annotations:** ${notes.length}  \n\n`;
  md += `---\n\n`;

  notes.forEach((note, idx) => {
    md += `### ${idx + 1}. ${note.title}\n\n`;
    md += `- **${themeLabelFor(note.themeIds)}:** ${themeNames(note.themeIds, options.themes)}\n`;
    const date = noteDateLabel(note);
    md += `- **Author:** ${note.author || 'Reader'}${date ? ` (${date})` : ''}\n`;
    md += `\n`;

    if (showsQuote(note, options)) {
      md += `> "${note.quote}"\n\n`;
    }

    if (showsBody(note)) md += `${note.content}\n\n`;

    md += `---\n\n`;
  });

  return md;
}

/**
 * Export annotations as a beautifully formatted PDF document
 */
export function exportToPDF(notes: ExportEntry[], options: ExportOptions): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const addNewPageIfNeeded = (requiredHeight: number) => {
    if (y + requiredHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
      drawHeaderFooter();
    }
  };

  const drawHeaderFooter = () => {
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text('Marginalia — Reader Annotations', margin, 12);
    const pageNumber = doc.getNumberOfPages();
    doc.text(`Page ${pageNumber}`, pageWidth - margin, 12, { align: 'right' });
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    doc.line(margin, 14, pageWidth - margin, 14);
  };

  // First page banner
  drawHeaderFooter();
  y = 24;

  // Title & Header Styling
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(28, 35, 33);
  doc.text(options.bookTitle, margin, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  // No author line for a document that has none (pasted excerpts, most uploads).
  const subtitle = [options.bookAuthor && `By ${options.bookAuthor}`, options.bookChapter].filter(Boolean).join(' • ');
  if (subtitle) {
    doc.text(subtitle, margin, y);
    y += 6;
  }

  // Meta metadata bar
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  doc.text(`Exported: ${dateStr}  |  Total Notes: ${notes.length}`, margin, y);
  y += 4;

  // Divider line
  doc.setDrawColor(67, 92, 82);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  if (notes.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    doc.setTextColor(120, 120, 120);
    doc.text('No annotations match the selected export filter.', margin, y);
    doc.save(`marginalia-annotations-${sanitizeFilename(options.bookTitle)}.pdf`);
    return;
  }

  // Iterate over notes
  notes.forEach((note, index) => {
    // Estimate note height
    const quoteLines = showsQuote(note, options)
      ? doc.splitTextToSize(`"${note.quote}"`, contentWidth - 8)
      : [];
    const contentLines: string[] = showsBody(note) ? doc.splitTextToSize(note.content, contentWidth - 4) : [];

    const estimatedHeight =
      12 + // title
      6 + // meta tags
      (quoteLines.length * 4.5 + (quoteLines.length > 0 ? 4 : 0)) +
      (contentLines.length * 5 + 4) +
      8; // padding and spacing

    addNewPageIfNeeded(estimatedHeight);

    // Note Card Background Box
    const cardTop = y;
    doc.setFillColor(250, 249, 246);
    doc.setDrawColor(210, 205, 195);
    doc.setLineWidth(0.3);

    // Note Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(28, 35, 33);
    const titleText = `${index + 1}. ${note.title}`;
    doc.text(titleText, margin + 3, y + 5);

    y += 9;

    // Meta line (Theme Tag, Author, Timestamp)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    const themeLabel = `${themeLabelFor(note.themeIds)}: ${themeNames(note.themeIds, options.themes)}  •  Author: ${note.author || 'Reader'}${noteDateLabel(note) ? `  •  ${noteDateLabel(note)}` : ''}`;
    doc.text(themeLabel, margin + 3, y);
    y += 5;

    // Quote Block (if exists)
    if (quoteLines.length > 0) {
      doc.setFillColor(235, 233, 227);
      doc.rect(margin + 2, y, contentWidth - 4, quoteLines.length * 4.5 + 2, 'F');

      doc.setDrawColor(67, 92, 82);
      doc.setLineWidth(1);
      doc.line(margin + 2, y, margin + 2, y + quoteLines.length * 4.5 + 2);

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(70, 70, 70);
      doc.text(quoteLines, margin + 6, y + 3.5);
      y += quoteLines.length * 4.5 + 5;
    }

    // Annotation Content Text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(contentLines, margin + 3, y + 2);
    y += contentLines.length * 5 + 4;

    // Draw outline of box
    const cardHeight = y - cardTop;
    doc.rect(margin, cardTop, contentWidth, cardHeight, 'S');

    y += 6; // gap between notes
  });

  // Trigger browser download
  const filename = `marginalia-annotations-${sanitizeFilename(options.bookTitle)}.pdf`;
  doc.save(filename);
}

/**
 * Helper to download text / markdown file to disk
 */
export function downloadTextFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 30);
}

/**
 * The date printed for a note: `createdAt` as a readable local date when present. Older notes
 * only have `timestamp`, which for some is the placeholder "Just now" — printing that in an
 * export claims a time it does not know, so it prints nothing instead.
 */
export function noteDateLabel(note: StickyNote): string {
  const created = note.createdAt ? new Date(note.createdAt) : null;
  if (created && !Number.isNaN(created.getTime())) {
    return created.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  const legacy = (note.timestamp || '').trim();
  return /^just now$/i.test(legacy) ? '' : legacy;
}

/**
 * A line of the export. Older callers pass sticky notes; text-document marks come through
 * `textMarksForExport` and carry their `kind`, so a highlight prints as its passage.
 */
export type ExportEntry = StickyNote & { kind?: TextMarkKind; isTerminology?: boolean };

/** A mark whose substance is the passage it covers, not words the reader wrote. */
function isPassage(entry: ExportEntry): boolean {
  return entry.kind !== undefined && entry.kind !== 'note';
}

/** The passage is printed when asked for, and always for a passage mark (it is the whole entry). */
function showsQuote(entry: ExportEntry, options: ExportOptions): boolean {
  return !!entry.quote && (options.includeQuotes || isPassage(entry));
}

/** A note always prints its body; a passage mark only when the reader wrote something on it. */
function showsBody(entry: ExportEntry): boolean {
  return !isPassage(entry) || !!entry.content;
}

const KIND_LABELS: Record<TextMarkKind, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikethrough',
  note: 'Note',
  question: 'Reaction (?)',
  star: 'Reaction (*)',
  exclamation: 'Reaction (!)',
  bold: 'Bold',
  circle: 'Circled'
};

/**
 * A text document's marks as export entries: one per mark (the ranges of a multi-paragraph mark
 * joined), in reading order. Marks migrated from older formats stored no quote, so the words are
 * taken from `paragraphs`, the document text split the way the reader splits it.
 */
export function textMarksForExport(marks: TextMark[], paragraphs: string[]): ExportEntry[] {
  const words = (m: TextMark) => m.quote ?? (paragraphs[m.anchor.paragraphIndex] ?? '').slice(m.anchor.start, m.anchor.end);
  const ordered = sortTextMarks(marks);
  return groupHeads(ordered).map((head) => {
    const ranges = head.groupId ? ordered.filter((m) => m.groupId === head.groupId) : [head];
    const quote = ranges.map(words).filter(Boolean).join(' ');
    const label = head.isTerminology ? 'Term' : KIND_LABELS[head.kind];
    const entry: ExportEntry = {
      id: head.id,
      kind: head.kind,
      paragraphIndex: head.anchor.paragraphIndex,
      color: head.color ?? '',
      // An untitled note is called what its card in the reader calls it.
      title: head.kind === 'note' ? head.title || 'Reader Note' : label,
      content: head.text ?? '',
      author: head.author ?? '',
      timestamp: head.timestamp ?? '',
      themeIds: head.themeIds ?? []
    };
    if (quote) entry.quote = quote;
    if (head.createdAt) entry.createdAt = head.createdAt;
    if (head.isTerminology) entry.isTerminology = true;
    return entry;
  });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The notes export as a printable page, for the desktop app's renderer (`/api/export/notes-pdf`).
 * Used instead of `exportToPDF` when any entry has right-to-left text: jsPDF's built-in fonts
 * have no Arabic or Hebrew glyphs and it cannot shape Nastaliq. Each block takes its direction
 * from its own words (`dir="auto"`), so an Urdu quote under an English note reads right.
 * `nastaliqFont` is a data: URI for the bundled font (the print window loads nothing remote).
 */
export function notesPrintHtml(notes: ExportEntry[], options: ExportOptions, nastaliqFont?: string, scriptStyle: 'nastaliq' | 'naskh' = 'nastaliq'): string {
  const face = nastaliqFont
    ? `@font-face{font-family:'Noto Nastaliq Urdu';src:url(${nastaliqFont}) format('woff2');unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFC;}`
    : '';
  const arabic = scriptStyle === 'naskh' ? "'Noto Naskh Arabic','Segoe UI'" : "'Noto Nastaliq Urdu'";
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const cards = notes
    .map((note, i) => {
      const quote = showsQuote(note, options) ? `<blockquote dir="auto">“${escapeHtml(note.quote!)}”</blockquote>` : '';
      const body = showsBody(note) && note.content ? `<p dir="auto">${escapeHtml(note.content).replace(/\n/g, '<br>')}</p>` : '';
      const meta = [`${themeLabelFor(note.themeIds)}: ${themeNames(note.themeIds, options.themes)}`, note.author ? `Author: ${note.author}` : '', noteDateLabel(note)]
        .filter(Boolean)
        .map(escapeHtml)
        .join(' • ');
      return `<section><h2 dir="auto">${i + 1}. ${escapeHtml(note.title)}</h2><div class="meta">${meta}</div>${quote}${body}</section>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${face}
body{font-family:Georgia,${arabic},serif;color:#1c2321;font-size:11pt;line-height:1.6}
:lang(ur),[dir=rtl]{font-family:${arabic},Georgia,serif;line-height:2.3}
h1{font-size:20pt;margin:0 0 4pt}.sub{color:#555;margin:0 0 2pt}.meta{color:#777;font-size:8.5pt;margin-bottom:6pt}
hr{border:0;border-top:2px solid #435c52;margin:8pt 0 14pt}
section{border:1px solid #d2cdc3;padding:8pt 10pt;margin-bottom:10pt;break-inside:avoid}
h2{font-size:12pt;margin:0 0 3pt}
blockquote{margin:0 0 6pt;padding:4pt 8pt;background:#ebe9e3;border-inline-start:3px solid #435c52;font-style:italic}
p{margin:0}</style></head><body>
<h1 dir="auto">${escapeHtml(options.bookTitle)}</h1>${options.bookAuthor ? `<p class="sub" dir="auto">By ${escapeHtml(options.bookAuthor)}</p>` : ''}
<div class="meta">Exported: ${escapeHtml(date)} | Total Notes: ${notes.length}</div><hr>
${notes.length ? cards : '<p><em>No annotations match the selected export filter.</em></p>'}
</body></html>`;
}
