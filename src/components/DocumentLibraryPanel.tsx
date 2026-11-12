/**
 * The library tab: everything currently stored on this device, with rename and delete.
 *
 * It reads from the store rather than from React state, so it shows what is actually on disk —
 * including documents from earlier sessions that the current session has never opened. That is
 * the whole point of it: the in-memory library only knows about this session.
 *
 * Delete is permanent and immediate: the record, the original file and the annotations are all
 * unlinked from the user's filesystem. Because there is no undo, it asks for confirmation inline
 * rather than deleting on the first click.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Trash2,
  Pencil,
  X,
  Check,
  FolderOpen,
  Loader2,
  HardDrive,
  RefreshCw,
  MessageSquare
} from './icons';
import {
  StoredDocumentMeta,
  StorageInfo,
  deleteStoredDocument,
  desktopBridge,
  fetchStorageInfo,
  listStoredDocuments,
  renameStoredDocument
} from '../utils/documentStorage';
import { ErrorDialog } from './ErrorDialog';
import { plural } from '../utils/plural';

interface DocumentLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  isDark?: boolean;
  /** Opens a stored document in the workspace. */
  onOpenDocument: (meta: StoredDocumentMeta) => void;
  /** The document currently open, highlighted in the list. */
  activeDocumentId?: string;
  /** Lets the app drop a deleted document from its own in-memory library too. */
  onDocumentDeleted?: (id: string) => void;
  onDocumentRenamed?: (id: string, title: string) => void;
  /** Bumped by the app after an upload, to pull the newly stored document into the list. */
  refreshToken?: number;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DocumentLibraryPanel: React.FC<DocumentLibraryPanelProps> = ({
  isOpen,
  onClose,
  isDark = false,
  onOpenDocument,
  activeDocumentId,
  onDocumentDeleted,
  onDocumentRenamed,
  refreshToken = 0
}) => {
  const [documents, setDocuments] = useState<StoredDocumentMeta[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** A rename or delete that the store refused. Both used to fail into nothing at all. */
  const [failure, setFailure] = useState<string | null>(null);

  const bridge = desktopBridge();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const [docs, info] = await Promise.all([listStoredDocuments(), fetchStorageInfo()]);
    setDocuments(docs);
    setStorage(info);
    setIsLoading(false);
  }, []);

  // Reload whenever the panel opens, and whenever the app signals something was stored. A list
  // fetched once on mount would go stale the moment a document was uploaded or deleted.
  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refreshToken, refresh]);

  const commitRename = async (id: string) => {
    const title = draftTitle.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    setBusyId(id);
    const updated = await renameStoredDocument(id, title);
    if (updated) {
      setDocuments((prev) => prev.map((d) => (d.id === id ? updated : d)));
      onDocumentRenamed?.(id, updated.title);
    } else {
      // Without this the row silently snapped back to its old name, which reads like the app
      // ignored the edit rather than like the write failed.
      setFailure('Could not rename that document. Its name on disk is unchanged.');
    }
    setBusyId(null);
    setRenamingId(null);
  };

  const commitDelete = async (id: string) => {
    setBusyId(id);
    const deleted = await deleteStoredDocument(id);
    if (deleted) {
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      onDocumentDeleted?.(id);
    } else {
      setFailure('Could not delete that document. It is still in My Collections.');
    }
    setBusyId(null);
    setConfirmingDeleteId(null);
  };

  if (!isOpen) return null;

  return (
    <aside
      // Docked beside the content on a wide window, but an overlay once the window is narrow
      // enough that a full-width panel in the flex row would squeeze the document to nothing.
      className={`flex flex-col min-h-0 border-l z-40 max-sm:fixed max-sm:inset-y-0 max-sm:right-0 max-sm:w-full max-sm:shadow-2xl sm:relative sm:h-full sm:w-80 sm:shrink-0 ${
        isDark ? 'bg-night-1 border-stone-800' : 'bg-white border-stone-200'
      }`}
      aria-label="My Collections"
    >
      <ErrorDialog open={Boolean(failure)} message={failure ?? ''} onClose={() => setFailure(null)} />

      {/* Header */}
      <div className={`px-4 py-3 border-b shrink-0 ${isDark ? 'border-stone-800' : 'border-stone-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-muted" />
            <h2 className="title-hand text-[26px] text-stone-900 dark:text-paper">My Collections</h2>
            <span className="text-[11px] text-muted tabular-nums">({documents.length})</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => void refresh()}
              title="Refresh"
              className="p-1.5 rounded-lg text-muted hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close My Collections"
              className="p-1.5 rounded-lg text-muted hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <p className="text-[11px] text-muted mt-1">Stored on this computer.</p>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {isLoading && documents.length === 0 ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
          </div>
        ) : documents.length === 0 ? (
          <div className="py-10 px-4 text-center space-y-2">
            <FileText className="w-8 h-8 text-stone-300 dark:text-stone-700 mx-auto" />
            <p className="text-[12px] text-muted">
              Nothing stored yet. Documents you add appear here and stay until you delete them.
            </p>
          </div>
        ) : (
          documents.map((doc) => {
            const isActive = doc.id === activeDocumentId;
            const isRenaming = renamingId === doc.id;
            const isConfirming = confirmingDeleteId === doc.id;

            return (
              <div
                key={doc.id}
                className={`rounded-xl border transition-all ${
                  isActive
                    ? 'border-gold/50 bg-gold/5'
                    : isDark
                      ? 'border-stone-800 bg-night-2 hover:border-stone-700'
                      : 'border-stone-200 bg-white hover:bg-stone-50'
                }`}
              >
                <div className="p-3">
                  {isRenaming ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(doc.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className={`flex-1 min-w-0 px-2 py-1 rounded-lg border text-[12px] focus:outline-none focus:ring-1 focus:ring-gold ${
                          isDark
                            ? 'bg-night border-stone-700 text-stone-100'
                            : 'bg-white border-stone-300 text-stone-900'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => void commitRename(doc.id)}
                        title="Save name"
                        className="p-1.5 rounded-lg text-gold hover:bg-gold/10 dark:hover:bg-gold/10 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        title="Cancel"
                        className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenDocument(doc)}
                      className="w-full text-left cursor-pointer group"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-medium text-[12.5px] text-stone-900 dark:text-stone-100 truncate group-hover:text-gold dark:group-hover:text-gold">
                            {doc.title}
                          </h4>
                          <p className="text-[10.5px] text-muted mt-0.5 font-spine">
                            {doc.format} · {plural(doc.wordCount, 'word')} · {formatBytes(doc.originalBytes)}
                          </p>
                          <p className="text-[10.5px] text-muted flex items-center gap-2 mt-0.5">
                            <span>{new Date(doc.updatedAt).toLocaleDateString()}</span>
                            {doc.annotationCount > 0 && (
                              <span className="flex items-center gap-0.5">
                                <MessageSquare className="w-2.5 h-2.5" />
                                {doc.annotationCount}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </button>
                  )}
                </div>

                {/* Actions */}
                {!isRenaming && (
                  <div
                    className={`flex items-center justify-end gap-0.5 px-2 py-1.5 border-t ${
                      isDark ? 'border-stone-800' : 'border-stone-100'
                    }`}
                  >
                    {isConfirming ? (
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="text-[10.5px] text-red-700 dark:text-red-400 flex-1 leading-tight">
                          Delete permanently from this computer?
                        </span>
                        <button
                          type="button"
                          onClick={() => void commitDelete(doc.id)}
                          disabled={busyId === doc.id}
                          className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10.5px] font-semibold cursor-pointer disabled:opacity-50"
                        >
                          {busyId === doc.id ? '…' : 'Delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          className="px-2 py-1 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 text-[10.5px] font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(doc.id);
                            setDraftTitle(doc.title);
                          }}
                          title="Rename"
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-muted hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 text-[10.5px] font-semibold cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(doc.id)}
                          title="Delete from this computer"
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 text-[10.5px] font-semibold cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Storage footer — shows the real folder, so "stored locally" is verifiable rather than
          something the user has to take on faith. */}
      {storage && (
        <div className={`px-3 py-2.5 border-t shrink-0 ${isDark ? 'border-stone-800' : 'border-stone-200'}`}>
          <p className="caps caps-sm text-muted mb-1">Stored at</p>
          <p className="text-[10.5px] text-stone-600 dark:text-stone-400 break-all leading-snug" title={storage.location}>
            {storage.location}
          </p>
          {bridge && (
            <button
              type="button"
              onClick={() => void bridge.revealStorageDir()}
              className="mt-1.5 flex items-center gap-1 text-[10.5px] font-semibold text-gold dark:text-gold hover:underline cursor-pointer"
            >
              <FolderOpen className="w-3 h-3" />
              Show in folder
            </button>
          )}
        </div>
      )}
    </aside>
  );
};
