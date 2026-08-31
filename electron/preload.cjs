/**
 * Preload bridge.
 *
 * The renderer runs sandboxed with no Node access, so this exposes exactly the desktop
 * capabilities the interface needs and nothing more. `window.marginaliaDesktop` being undefined
 * is how the client detects it is running outside the desktop app, which is what makes the
 * storage controls in Settings appear only where they can actually work.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marginaliaDesktop', {
  isDesktop: true,
  /** Absolute path of the folder documents are stored in. */
  getStorageDir: () => ipcRenderer.invoke('marginalia:storage-dir'),
  /** Opens that folder in Finder / File Explorer. */
  revealStorageDir: () => ipcRenderer.invoke('marginalia:reveal-storage-dir'),
  /** Prompts for a new folder, offers to move the library into it, and re-points the store. */
  chooseStorageDir: () => ipcRenderer.invoke('marginalia:choose-storage-dir'),
  /** Returns the library to the default per-user location. */
  resetStorageDir: () => ipcRenderer.invoke('marginalia:reset-storage-dir'),
  /** App version and platform, for the About section. */
  getAppInfo: () => ipcRenderer.invoke('marginalia:app-info')
});
