const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  listFiles:   (dir)              => ipcRenderer.invoke('list-files', dir),
  readFile:    (path)             => ipcRenderer.invoke('read-file', path),
  writeFile:   (path, content)    => ipcRenderer.invoke('write-file', path, content),
  checkExists: (path)             => ipcRenderer.invoke('check-exists', path),
  openFolder:  ()                 => ipcRenderer.invoke('open-folder'),
  saveDialog:  (defaultPath)      => ipcRenderer.invoke('save-dialog', defaultPath),
})
