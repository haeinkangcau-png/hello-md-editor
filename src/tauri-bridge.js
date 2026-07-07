// Tauri ↔ frontend bridge.
//
// The React app was written for Electron and talks to the desktop backend
// through `window.electronAPI`. Under Tauri we synthesize that exact object,
// backed by Tauri `invoke()` commands (see src-tauri/src/lib.rs), so the whole
// frontend runs unchanged. This module MUST be imported before anything reads
// `window.electronAPI` — it is the first import in src/main.jsx.

const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

if (isTauri && !window.electronAPI) {
  const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args)
  const listen = (event, cb) => window.__TAURI__.event.listen(event, cb)

  window.electronAPI = {
    // ── File system ──
    listFiles:       (dir)              => invoke('list_files', { dir }),
    readFile:        (path)             => invoke('read_file', { path }),
    writeFile:       (path, content)    => invoke('write_file', { path, content }),
    checkExists:     (path)             => invoke('check_exists', { path }),
    createFolder:    (dirPath)          => invoke('create_folder', { dirPath }),
    renameFile:      (oldPath, newPath) => invoke('rename_file', { oldPath, newPath }),
    saveImage:       (dir, name, b64)   => invoke('save_image', { dir, fileName: name, base64Data: b64 }),
    cleanupImages:   (dir, refs)        => invoke('cleanup_images', { assetsDir: dir, referencedImages: refs }),
    copyAssets:      (src, dest)        => invoke('copy_assets', { src, dest }),
    readImageBase64: (filePath)         => invoke('read_image_base64', { path: filePath }),

    // ── Dialogs / shell ──
    openFolder:       ()                => invoke('open_folder'),
    saveDialog:       (defaultPath)     => invoke('save_dialog', { defaultPath }),
    revealInExplorer: (filePath)        => invoke('reveal_in_explorer', { filePath }),
    openPath:         (target)          => invoke('open_path', { target }),
    // WebView2 ignores window.open() for external URLs, so route them to a
    // native command that launches the default browser (see open_external).
    openExternal:     (url)             => invoke('open_external', { url }),

    // ── Windows ──
    openNewWindow:      ()                    => invoke('open_new_window'),
    openScheduleWindow: (content, fileName)   => invoke('open_schedule_window', { content, fileName }),
    openSpecWindow:     (content, fileName)   => invoke('open_spec_window', { content, fileName }),

    // ── Capture ──
    captureFullHtml: (opts) => invoke('capture_full_html', {
      html: (opts && opts.html) || '',
      viewWidth: opts && opts.viewWidth,
      scale: opts && opts.scale,
    }),
    // Viewport-rect capture was unused by the UI; keep a stub for API parity.
    captureAndCopy: () => Promise.reject('not supported'),

    // ── File association / "open with" ──
    getOpenFilePath: () => invoke('get_open_file_path'),
    onOpenFile: (cb) => {
      // Electron's onOpenFile returns a synchronous unsubscribe function; Tauri's
      // listen() is async, so we bridge the two contracts here.
      let unlisten = null
      let removed = false
      listen('open-file', (e) => cb(e.payload))
        .then((fn) => { if (removed) fn(); else unlisten = fn })
        .catch(() => {})
      return () => { removed = true; if (unlisten) { unlisten(); unlisten = null } }
    },

    // ── Native OS file drop ──
    // Tauri (dragDropEnabled defaults to true) intercepts OS file drops at the
    // webview level, so the HTML5 `drop` event / `dataTransfer.files` never
    // fire in the renderer — and even if they did, WebView2 File objects carry
    // no `.path`. Instead we consume Tauri's native drag-drop event, which
    // delivers the real filesystem paths. We scope it to the *current* webview
    // (onDragDropEvent uses a per-webview listener) so that, with several editor
    // windows open, a drop only opens the file in the window it landed on.
    // cb receives an array of dropped paths.
    onFileDrop: (cb) => {
      let unlisten = null
      let removed = false
      window.__TAURI__.webview
        .getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event?.payload?.type !== 'drop') return
          const paths = event.payload.paths || []
          if (paths.length) cb(paths)
        })
        .then((fn) => { if (removed) fn(); else unlisten = fn })
        .catch(() => {})
      return () => { removed = true; if (unlisten) { unlisten(); unlisten = null } }
    },
  }
}
