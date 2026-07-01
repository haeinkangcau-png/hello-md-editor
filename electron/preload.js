const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  listFiles:   (dir)              => ipcRenderer.invoke('list-files', dir),
  readFile:    (path)             => ipcRenderer.invoke('read-file', path),
  writeFile:   (path, content)    => ipcRenderer.invoke('write-file', path, content),
  checkExists: (path)             => ipcRenderer.invoke('check-exists', path),
  openFolder:      ()                 => ipcRenderer.invoke('open-folder'),
  saveDialog:      (defaultPath)      => ipcRenderer.invoke('save-dialog', defaultPath),
  captureAndCopy:    (rect)           => ipcRenderer.invoke('capture-and-copy', rect),
  captureFullHtml:   (opts)           => ipcRenderer.invoke('capture-full-html', opts),
  revealInExplorer:  (filePath)       => ipcRenderer.invoke('reveal-in-explorer', filePath),
  openPath:          (target)         => ipcRenderer.invoke('open-path', target),
  createFolder:      (dirPath)        => ipcRenderer.invoke('create-folder', dirPath),
  renameFile:        (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  saveImage:         (dir, name, b64)  => ipcRenderer.invoke('save-image', dir, name, b64),
  cleanupImages:     (dir, refs)       => ipcRenderer.invoke('cleanup-images', dir, refs),
  copyAssets:        (src, dest)        => ipcRenderer.invoke('copy-assets', src, dest),
  readImageBase64:   (filePath)         => ipcRenderer.invoke('read-image-base64', filePath),
  getOpenFilePath:   ()               => ipcRenderer.invoke('get-open-file-path'),
  openNewWindow:      ()                  => ipcRenderer.invoke('open-new-window'),
  openScheduleWindow: (content, fileName) => ipcRenderer.invoke('open-schedule-window', content, fileName),
  openSpecWindow:     (content, fileName) => ipcRenderer.invoke('open-spec-window', content, fileName),
  onOpenFile:        (cb)             => {
    const handler = (_, p) => cb(p)
    ipcRenderer.on('open-file', handler)
    return () => ipcRenderer.removeListener('open-file', handler)
  },
})
