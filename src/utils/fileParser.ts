/**
 * Client-side file parser for extracting text from uploaded documents.
 * Supports: .txt, .pdf, .docx, .epub, .htm/.html
 */

import { prepareHtmlDocument } from './htmlDocument';

export interface ParseResult {
  title: string;
  text: string;
  pageCount?: number;
  format: string;
  /**
   * HTML imports only: the self-contained, print-ready document. It is converted to a PDF on
   * the way into the store so the annotating workspace can paginate and mark it up like any
   * other PDF — see `utils/htmlDocument.ts` for why pagination happens at import time.
   */
  printableHtml?: string;
  /** HTML imports only: how many sibling files (images, stylesheets) were embedded. */
  inlinedAssets?: number;
  /**
   * True for a PDF whose pages carry no text layer — a scan, or a book assembled from page
   * images. The file is perfectly readable and annotatable; only the things that need machine
   * -readable text (selection, search, AI analysis) are unavailable, and the caller says so
   * rather than the import failing.
   */
  textLayerMissing?: boolean;
}

/**
 * Parse a File object and extract its text content.
 */
export async function parseFile(file: File, siblings: File[] = []): Promise<ParseResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const title = file.name.replace(/\.[^/.]+$/, '');

  switch (ext) {
    case 'txt':
      return parseTxt(file, title);
    case 'pdf':
      return parsePdf(file, title);
    case 'docx':
      return parseDocx(file, title);
    case 'epub':
      return parseEpub(file, title);
    case 'htm':
    case 'html':
    case 'xhtml':
      return parseHtml(file, siblings);
    default:
      throw new Error(
        `Unsupported file format: .${ext}. Supported formats: .txt, .pdf, .docx, .epub, .htm`
      );
  }
}

/**
 * Parse plain text files using FileReader.
 */
async function parseTxt(file: File, title: string): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      if (!text.trim()) {
        reject(new Error('The text file is empty.'));
        return;
      }
      resolve({ title, text: text.trim(), format: 'TXT' });
    };
    reader.onerror = () => reject(new Error('Failed to read the text file.'));
    reader.readAsText(file);
  });
}

/**
 * Parse PDF files using pdfjs-dist (Mozilla PDF.js).
 */
async function parsePdf(file: File, title: string): Promise<ParseResult> {
  const pdfjsLib = await import('pdfjs-dist');

  // Set the worker source to the bundled worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  // The same WASM decoders the viewer needs — see `PDF_WASM_URL` in `components/pdf/PdfWorkspace`.
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, wasmUrl: '/pdf-wasm/' }).promise;

  // Note: page boundaries are intentionally NOT embedded as their own
  // "--- Page N ---" text blocks here. Paragraph indices computed from this
  // text (by the reader, the inspection panel, and the Gemini thematic
  // analysis prompt) all rely on splitting on blank lines, and a divider
  // block would silently shift every paragraph index after it out of sync
  // between what the AI counted and what the UI renders.
  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ')
      .trim();
    if (pageText) {
      textParts.push(pageText);
    }
  }

  const fullText = textParts.join('\n\n');

  /*
    A PDF with no extractable text is NOT a failure.

    Scanned books, and books assembled from page images, have no text layer at all — and refusing
    them meant the one kind of document a reader most wants to mark up by hand could not be opened
    at all. The pages render perfectly in the viewer and every drawing tool works on them; the
    only things genuinely unavailable are the ones that need machine-readable words. So the import
    succeeds, and stands in a short note explaining what is missing, because the store needs some
    text to file the document under and a silent empty string would read as a corrupt import.
  */
  if (!fullText.trim()) {
    return {
      title,
      text:
        `${title}\n\n` +
        'This PDF has no text layer — it is a scan, or a document built from page images. ' +
        'You can read it and annotate it by hand, but selecting text, searching it and running ' +
        'the thematic analysis need machine-readable words, which this file does not carry. ' +
        'Running it through OCR first would restore them.',
      pageCount: pdf.numPages,
      format: 'PDF',
      textLayerMissing: true
    };
  }

  return {
    title,
    text: fullText.trim(),
    pageCount: pdf.numPages,
    format: 'PDF'
  };
}

/**
 * Parse DOCX files using mammoth.js.
 */
async function parseDocx(file: File, title: string): Promise<ParseResult> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });

  if (!result.value.trim()) {
    throw new Error('The DOCX file appears to be empty or contains no extractable text.');
  }

  return {
    title,
    text: result.value.trim(),
    format: 'DOCX'
  };
}

/**
 * Parse EPUB files using epubjs.
 * Extracts text from each chapter/spine item.
 */
async function parseEpub(file: File, title: string): Promise<ParseResult> {
  const ePub = (await import('epubjs')).default;
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer);

  await book.ready;

  const spine = book.spine as any;
  const textParts: string[] = [];

  // Iterate through spine items (chapters)
  for (const item of spine.items) {
    if (!item.href) continue;
    try {
      const doc = await book.load(item.href);
      // doc is an XML/HTML document; extract text content
      if (doc && typeof doc === 'object' && 'body' in (doc as any)) {
        const body = (doc as Document).body;
        if (body) {
          const chapterText = body.textContent?.trim();
          if (chapterText) {
            textParts.push(chapterText);
          }
        }
      }
    } catch {
      // Skip chapters that fail to load
      continue;
    }
  }

  // Clean up
  book.destroy();

  const fullText = textParts.join('\n\n');
  if (!fullText.trim()) {
    throw new Error('Could not extract text from this EPUB. The file may be DRM-protected or corrupted.');
  }

  return {
    title,
    text: fullText.trim(),
    format: 'EPUB'
  };
}

/**
 * Parse an HTML document, together with any sibling files selected alongside it.
 *
 * Unlike the other formats this returns more than text: it also returns a self-contained copy
 * of the page with its images and stylesheets embedded, because the caller converts that to a
 * PDF so the document becomes annotatable rather than read-only.
 */
async function parseHtml(file: File, siblings: File[]): Promise<ParseResult> {
  const prepared = await prepareHtmlDocument(file, siblings);
  return {
    title: prepared.title,
    text: prepared.text,
    format: 'HTML',
    printableHtml: prepared.printableHtml,
    inlinedAssets: prepared.inlinedAssets
  };
}
