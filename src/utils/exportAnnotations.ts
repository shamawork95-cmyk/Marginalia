import { jsPDF } from 'jspdf';
import { StickyNote } from '../types';

export interface ExportOptions {
  bookTitle: string;
  bookAuthor: string;
  bookChapter?: string;
  filterType: 'all' | 'manual' | 'ai';
  themeFilter?: string;
  format: 'pdf' | 'markdown' | 'txt';
  includeQuotes: boolean;
  includeAiDetails: boolean;
}

/**
 * Filter annotations based on user selection
 */
export function getFilteredAnnotations(
  notes: StickyNote[],
  filterType: 'all' | 'manual' | 'ai',
  themeFilter: string = 'All'
): StickyNote[] {
  return notes.filter((note) => {
    // Type match
    if (filterType === 'manual' && note.isAiGenerated) return false;
    if (filterType === 'ai' && !note.isAiGenerated) return false;
    // Theme match
    if (themeFilter !== 'All' && note.themeTag !== themeFilter) return false;
    return true;
  });
}

/**
 * Generate formatted plain text representation
 */
export function generatePlainText(notes: StickyNote[], options: ExportOptions): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let output = `=================================================================\n`;
  output += `  MARGINALIA - ANNOTATIONS & MARGIN NOTES\n`;
  output += `=================================================================\n\n`;
  output += `Title:    ${options.bookTitle}\n`;
  output += `Author:   ${options.bookAuthor}\n`;
  if (options.bookChapter) output += `Chapter:  ${options.bookChapter}\n`;
  output += `Exported: ${dateStr}\n`;
  output += `Total:    ${notes.length} annotation(s)\n`;
  output += `Filter:   ${options.filterType.toUpperCase()} | Theme: ${options.themeFilter || 'All'}\n\n`;
  output += `-----------------------------------------------------------------\n\n`;

  notes.forEach((note, idx) => {
    const typeLabel = note.isAiGenerated ? '[AI-ASSISTED NOTE]' : '[MANUAL NOTE]';
    output += `${idx + 1}. ${note.title} ${typeLabel}\n`;
    output += `   Theme:     ${note.themeTag || 'General'}\n`;
    output += `   Author:    ${note.author || (note.isAiGenerated ? 'AI Assistant' : 'Reader')}\n`;
    output += `   Date:      ${note.timestamp}\n`;
    if (note.confidence && options.includeAiDetails) {
      output += `   Confidence: ${Math.round(note.confidence * 100)}%\n`;
    }

    if (note.quote && options.includeQuotes) {
      output += `\n   Passage Excerpt:\n`;
      output += `   "${note.quote}"\n`;
    }

    output += `\n   Annotation Note:\n`;
    output += `   ${note.content}\n`;

    if (note.rationale && options.includeAiDetails) {
      output += `\n   AI Rationale:\n   ${note.rationale}\n`;
    }

    output += `\n-----------------------------------------------------------------\n\n`;
  });

  return output;
}

/**
 * Generate structured Markdown representation
 */
export function generateMarkdown(notes: StickyNote[], options: ExportOptions): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let md = `# Marginalia Notes: ${options.bookTitle}\n\n`;
  md += `**Author:** ${options.bookAuthor}  \n`;
  if (options.bookChapter) md += `**Chapter:** ${options.bookChapter}  \n`;
  md += `**Export Date:** ${dateStr}  \n`;
  md += `**Total Annotations:** ${notes.length} (${notes.filter(n => n.isAiGenerated).length} AI-assisted, ${notes.filter(n => !n.isAiGenerated).length} manual)  \n\n`;
  md += `---\n\n`;

  notes.forEach((note, idx) => {
    const badge = note.isAiGenerated ? '`✨ AI-Assisted`' : '`✍️ Manual`';
    md += `### ${idx + 1}. ${note.title} ${badge}\n\n`;
    md += `- **Theme:** ${note.themeTag || 'General'}\n`;
    md += `- **Author:** ${note.author || (note.isAiGenerated ? 'AI Assistant' : 'Reader')} (${note.timestamp})\n`;
    if (note.confidence && options.includeAiDetails) {
      md += `- **AI Confidence:** ${Math.round(note.confidence * 100)}%\n`;
    }
    md += `\n`;

    if (note.quote && options.includeQuotes) {
      md += `> "${note.quote}"\n\n`;
    }

    md += `${note.content}\n\n`;

    if (note.rationale && options.includeAiDetails) {
      md += `*💡 Rationale:* ${note.rationale}\n\n`;
    }

    md += `---\n\n`;
  });

  return md;
}

/**
 * Export annotations as a beautifully formatted PDF document
 */
export function exportToPDF(notes: StickyNote[], options: ExportOptions): void {
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
  const subtitle = `By ${options.bookAuthor}${options.bookChapter ? ` • ${options.bookChapter}` : ''}`;
  doc.text(subtitle, margin, y);
  y += 6;

  // Meta metadata bar
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const manualCount = notes.filter((n) => !n.isAiGenerated).length;
  const aiCount = notes.filter((n) => n.isAiGenerated).length;
  doc.text(
    `Exported: ${dateStr}  |  Total Notes: ${notes.length} (${manualCount} Manual, ${aiCount} AI-Assisted)`,
    margin,
    y
  );
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
    const quoteLines = note.quote && options.includeQuotes
      ? doc.splitTextToSize(`"${note.quote}"`, contentWidth - 8)
      : [];
    const contentLines = doc.splitTextToSize(note.content, contentWidth - 4);
    const rationaleLines = note.rationale && options.includeAiDetails
      ? doc.splitTextToSize(`Rationale: ${note.rationale}`, contentWidth - 8)
      : [];

    const estimatedHeight =
      12 + // title and badge
      6 + // meta tags
      (quoteLines.length * 4.5 + (quoteLines.length > 0 ? 4 : 0)) +
      (contentLines.length * 5 + 4) +
      (rationaleLines.length * 4 + (rationaleLines.length > 0 ? 4 : 0)) +
      8; // padding and spacing

    addNewPageIfNeeded(estimatedHeight);

    // Note Card Background Box
    const cardTop = y;
    const cardColor = note.isAiGenerated ? [243, 248, 246] : [250, 249, 246]; // slight warm tint
    doc.setFillColor(cardColor[0], cardColor[1], cardColor[2]);
    doc.setDrawColor(note.isAiGenerated ? 139 : 210, note.isAiGenerated ? 170 : 205, note.isAiGenerated ? 160 : 195);
    doc.setLineWidth(0.3);

    // Note Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(28, 35, 33);
    const titleText = `${index + 1}. ${note.title}`;
    doc.text(titleText, margin + 3, y + 5);

    // Type Badge (AI or Manual)
    const badgeText = note.isAiGenerated ? 'AI-ASSISTED' : 'MANUAL';
    const badgeColor = note.isAiGenerated ? [67, 92, 82] : [120, 110, 95];
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(badgeColor[0], badgeColor[1], badgeColor[2]);
    doc.text(badgeText, pageWidth - margin - 3, y + 5, { align: 'right' });

    y += 9;

    // Meta line (Theme Tag, Author, Timestamp)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    const themeLabel = `Theme: ${note.themeTag || 'General'}  •  Author: ${note.author || 'Reader'}  •  ${note.timestamp}`;
    doc.text(themeLabel, margin + 3, y);
    y += 5;

    // Quote Block (if exists)
    if (note.quote && options.includeQuotes) {
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

    // AI Rationale (if applicable)
    if (note.rationale && options.includeAiDetails) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(67, 92, 82);
      doc.text(rationaleLines, margin + 3, y);
      y += rationaleLines.length * 4 + 3;
    }

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
