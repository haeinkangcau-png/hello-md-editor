// Unified API: Electron IPC in desktop, File System Access API in browser

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

// ── Web: handle registry ───────────────────────────────────
// Maps virtual path string → FileSystemFileHandle
const fileHandles = new Map()
function regFile(path, handle) { fileHandles.set(path, handle) }

// ── Web: recursive directory listing ──────────────────────
async function listDirHandle(dirHandle, parentPath) {
  const items = []
  for await (const [name, handle] of dirHandle.entries()) {
    const path = `${parentPath}/${name}`
    if (handle.kind === 'directory') {
      items.push({ name, path, isDirectory: true, handle })
    } else if (handle.kind === 'file' && name.endsWith('.md')) {
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
    listFiles:   dir          => wrap(api.listFiles(dir)),
    readFile:    path         => wrap(api.readFile(path)),
    writeFile:   (path, cnt)  => wrap(api.writeFile(path, cnt)),
    checkExists: path         => api.checkExists(path).catch(() => false),
    openFolder:  ()           => api.openFolder(),
    saveDialog:  defaultPath  => api.saveDialog(defaultPath),
  }
}

// ── Web ────────────────────────────────────────────────────
function makeWebAPI() {
  return {
    listFiles: async (virtualPath) => {
      // virtualPath is stored in fileHandles as a dirHandle
      const dirHandle = fileHandles.get(virtualPath)
      if (!dirHandle) throw new Error('디렉토리를 찾을 수 없습니다')
      const items = await listDirHandle(dirHandle, virtualPath)
      return { items, dir: virtualPath }
    },

    readFile: async (path) => {
      const handle = fileHandles.get(path)
      if (!handle) throw new Error('파일을 찾을 수 없습니다')
      const file = await handle.getFile()
      const content = await file.text()
      return { content }
    },

    writeFile: async (path, content) => {
      const handle = fileHandles.get(path)
      if (!handle) throw new Error('파일 핸들을 찾을 수 없습니다')
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      return {}
    },

    checkExists: async (path) => fileHandles.has(path),

    openFolder: async () => {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
        const virtualPath = dirHandle.name
        regFile(virtualPath, dirHandle)         // store dir handle under its name
        return virtualPath
      } catch {
        return null
      }
    },

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

export const listFiles   = impl.listFiles
export const readFile    = impl.readFile
export const writeFile   = impl.writeFile
export const checkExists = impl.checkExists
export const openFolder  = impl.openFolder
export const saveDialog  = impl.saveDialog

// Web only: register a file handle after user picks a file
export function registerFileHandle(path, handle) { regFile(path, handle) }

// Web only: open a file picker and return { path, content }
export async function pickAndReadFile() {
  if (isElectron) return null
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
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
