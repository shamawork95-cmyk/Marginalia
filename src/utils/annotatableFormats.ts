/**
 * Which stored formats open in the annotating workspace rather than the text-only analysis
 * screen.
 *
 * The workspace is built on pdf.js and positions every mark as a fraction of a *page box*
 * (see `components/pdf/annotationModel.ts`), so it can only serve documents whose stored
 * original is a real paginated PDF. That is true of an uploaded PDF, and — since the HTML
 * import converts the page to a PDF on the way in — of an imported HTML book too. DOCX, EPUB
 * and TXT are kept as their original bytes and have no page geometry, so they stay text-only.
 *
 * Kept in one place because the same question is asked from four screens, and having them
 * disagree would show a reader an "Annotate" affordance that opens an empty viewer.
 */
export const ANNOTATABLE_FORMATS = ['PDF', 'HTML'] as const;

export function isAnnotatableFormat(format?: string | null): boolean {
  return format === 'PDF' || format === 'HTML';
}
