/**
 * Client-side file parser for extracting text from uploaded documents.
 * Supports: .txt, .pdf, .docx, .epub
 */

export interface ParseResult {
  title: string;
  text: string;
  pageCount?: number;
  format: string;
}

/**
 * Parse a File object and extract its text content.
 */
export async function parseFile(file: File): Promise<ParseResult> {
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
    default:
      throw new Error(`Unsupported file format: .${ext}. Supported formats: .txt, .pdf, .docx, .epub`);
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
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

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
  if (!fullText.trim()) {
    throw new Error('Could not extract text from this PDF. It may be image-based or scanned.');
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
