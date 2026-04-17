// All calls go through Electron's IPC bridge (window.electronAPI)
const api = window.electronAPI

function wrap(promise) {
  return promise.catch(err => { throw new Error(err.message || String(err)) })
}

export const listFiles   = (dir)            => wrap(api.listFiles(dir))
export const readFile    = (path)           => wrap(api.readFile(path))
export const writeFile   = (path, content)  => wrap(api.writeFile(path, content))
export const checkExists = (path)           => api.checkExists(path).catch(() => false)
export const openFolder  = ()               => api.openFolder()
export const saveDialog  = (defaultPath)    => api.saveDialog(defaultPath)
