// Unified API: Electron IPC in desktop, File System Access API in browser

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

// ── Web: in-memory handle cache ────────────────────────────
const fileHandles = new Map()

// ── IndexedDB: persist handles across sessions ─────────────
const idb = (() => {
  let _db = null

  async function open() {
    if (_db) return _db
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('md-viewer-v1', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('handles')
      req.onsuccess = () => { _db = req.result; resolve(_db) }
      req.onerror = () => reject(req.error)
    })
  }

  return {
    async set(key, value) {
      try {
        const db = await open()
        await new Promise((res, rej) => {
          const tx = db.transaction('handles', 'readwrite')
          tx.objectStore('handles').put(value, key)
          tx.oncomplete = res
          tx.onerror = () => rej(tx.error)
        })
      } catch { /* silent */ }
    },
    async get(key) {
      try {
        const db = await open()
        return await new Promise((res, rej) => {
          const tx = db.transaction('handles', 'readonly')
          const req = tx.objectStore('handles').get(key)
          req.onsuccess = () => res(req.result)
          req.onerror = () => rej(req.error)
        })
      } catch { return undefined }
    },
  }
})()

function regFile(path, handle) {
  fileHandles.set(path, handle)
  idb.set(path, handle)   // fire-and-forget
}

// Request / verify permission on a restored handle
async function checkPermission(handle, mode = 'readwrite') {
  if (typeof handle.queryPermission !== 'function') return true
  const q = await handle.queryPermission({ mode })
  if (q === 'granted') return true
  const r = await handle.requestPermission({ mode })
  return r === 'granted'
}

// Resolve handle: memory → IndexedDB → null
async function resolveHandle(path, mode = 'readwrite') {
  const cached = fileHandles.get(path)
  if (cached) return cached

  const stored = await idb.get(path)
  if (!stored) return null

  const ok = await checkPermission(stored, mode)
  if (!ok) return null

  fileHandles.set(path, stored)   // restore to memory
  return stored
}

// ── Web: recursive directory listing ──────────────────────
async function listDirHandle(dirHandle, parentPath) {
  const items = []
  for await (const [name, handle] of dirHandle.entries()) {
    const path = `${parentPath}/${name}`
    if (handle.kind === 'directory') {
      items.push({ name, path, isDirectory: true, handle })
    } else if (handle.kind === 'file' && (name.endsWith('.md') || name.endsWith('.html'))) {
      regFile(path, handle)
      items.push({ name, path, isDirectory: false })
    }
  }
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return items
}

// ── Electron ───────────────────────────────────────────────
function makeElectronAPI() {
  const api = window.electronAPI
  const wrap = p => p.catch(err => { throw new Error(err.message || String(err)) })
  return {
    listFiles:        dir          => wrap(api.listFiles(dir)),
    readFile:         path         => wrap(api.readFile(path)),
    writeFile:        (path, cnt)  => wrap(api.writeFile(path, cnt)),
    checkExists:      path         => api.checkExists(path).catch(() => false),
    openFolder:       ()           => api.openFolder(),
    saveDialog:       defaultPath  => api.saveDialog(defaultPath),
    revealInExplorer: path         => api.revealInExplorer(path),
  }
}

// ── Web ────────────────────────────────────────────────────
function makeWebAPI() {
  return {
    listFiles: async (virtualPath) => {
      const dirHandle = await resolveHandle(virtualPath, 'readwrite')
      if (!dirHandle) throw new Error('디렉토리를 찾을 수 없습니다')
      const items = await listDirHandle(dirHandle, virtualPath)
      return { items, dir: virtualPath }
    },

    readFile: async (path) => {
      const handle = await resolveHandle(path, 'read')
      if (!handle) throw new Error('파일을 찾을 수 없습니다')
      const file = await handle.getFile()
      const content = await file.text()
      return { content }
    },

    writeFile: async (path, content) => {
      const handle = await resolveHandle(path, 'readwrite')
      if (!handle) throw new Error('파일 핸들을 찾을 수 없습니다')
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      return {}
    },

    checkExists: async (path) => !!(await resolveHandle(path, 'read')),

    openFolder: async () => {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
        const virtualPath = dirHandle.name
        regFile(virtualPath, dirHandle)
        return virtualPath
      } catch {
        return null
      }
    },

    revealInExplorer: async () => {},

    saveDialog: async (currentPath) => {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: currentPath?.split(/[\\/]/).pop() || 'untitled.md',
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
        })
        const path = handle.name
        regFile(path, handle)
        return path
      } catch {
        return null
      }
    },
  }
}

// ── Export ─────────────────────────────────────────────────
const impl = isElectron ? makeElectronAPI() : makeWebAPI()

export const listFiles        = impl.listFiles
export const readFile         = impl.readFile
export const writeFile        = impl.writeFile
export const checkExists      = impl.checkExists
export const openFolder       = impl.openFolder
export const saveDialog       = impl.saveDialog
export const revealInExplorer = impl.revealInExplorer

// Web only: register a file handle after user picks a file
export function registerFileHandle(path, handle) { regFile(path, handle) }

// Web only: open a file picker and return { path, content }
export async function pickAndReadFile() {
  if (isElectron) return null
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Markdown / HTML', accept: { 'text/markdown': ['.md'], 'text/html': ['.html'] } }],
    })
    regFile(handle.name, handle)
    const file = await handle.getFile()
    const content = await file.text()
    return { path: handle.name, name: handle.name, content }
  } catch {
    return null
  }
}

export const isWeb = !isElectron
