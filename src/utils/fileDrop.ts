/**
 * Collecting the files behind a drop, including whole folders.
 *
 * Dropping the folder is the natural gesture for the documents this matters to: a book saved
 * as HTML arrives as a `.htm` file plus a sibling folder of images, and `DataTransfer.files`
 * alone reports a dropped directory as a single unreadable zero-byte entry. Walking the entry
 * tree instead is what lets the import find the cover image sitting next to the page.
 */

/** Guards against a mis-drop of something enormous walking a home directory for minutes. */
const MAX_FILES = 400;
const MAX_DEPTH = 4;

/** The `FileSystemEntry` API predates types for it being useful; this is the shape we rely on. */
interface DirectoryEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file(onSuccess: (file: File) => void, onError: (err: unknown) => void): void;
  createReader(): {
    readEntries(
      onSuccess: (entries: DirectoryEntryLike[]) => void,
      onError: (err: unknown) => void
    ): void;
  };
}

function readEntries(entry: DirectoryEntryLike): Promise<DirectoryEntryLike[]> {
  const reader = entry.createReader();
  return new Promise((resolve) => {
    const all: DirectoryEntryLike[] = [];
    // readEntries hands back at most 100 entries per call and signals the end with an empty
    // batch, so it has to be drained in a loop rather than called once.
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        if (all.length >= MAX_FILES) {
          resolve(all);
          return;
        }
        readBatch();
      }, () => resolve(all));
    };
    readBatch();
  });
}

function readFile(entry: DirectoryEntryLike): Promise<File | null> {
  return new Promise((resolve) => entry.file((file) => resolve(file), () => resolve(null)));
}

async function walk(entry: DirectoryEntryLike, depth: number, out: File[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile) {
    const file = await readFile(entry);
    if (file) out.push(file);
    return;
  }
  if (entry.isDirectory && depth < MAX_DEPTH) {
    for (const child of await readEntries(entry)) {
      await walk(child, depth + 1, out);
    }
  }
}

/**
 * Every file in a drop, descending into any folders it contained.
 *
 * Falls back to the flat `DataTransfer.files` list when the entry API is unavailable, so a
 * plain single-file drop keeps working regardless.
 */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((item) => (item.kind === 'file' ? (item as any).webkitGetAsEntry?.() : null))
    .filter(Boolean) as DirectoryEntryLike[];

  if (entries.length === 0) return Array.from(dataTransfer.files || []);

  const collected: File[] = [];
  for (const entry of entries) {
    await walk(entry, 0, collected);
  }
  return collected.length > 0 ? collected : Array.from(dataTransfer.files || []);
}

/** Extensions that can be the document itself, as opposed to an asset it references. */
const DOCUMENT_PATTERN = /\.(pdf|docx?|epub|txt|x?html?)$/i;

/**
 * Splits a batch of files into the one document to open and the assets that came with it.
 *
 * Returns nothing when the batch holds no readable document — a folder of loose images, say —
 * so the caller can say that rather than trying to parse a JPEG.
 */
export function pickDocumentAndSiblings(
  files: File[]
): { document: File; siblings: File[] } | null {
  // A directory listing arrives in arbitrary order, so the document is chosen by kind rather
  // than by position. HTML wins ties: when a capture folder contains both the page and, say, a
  // stray PDF asset, the page is the thing the reader meant to open.
  const documents = files.filter((f) => DOCUMENT_PATTERN.test(f.name));
  if (documents.length === 0) return null;

  const chosen = documents.find((f) => /\.x?html?$/i.test(f.name)) || documents[0];
  return { document: chosen, siblings: files.filter((f) => f !== chosen) };
}
