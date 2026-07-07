// Unified API: Electron IPC / Tauri invoke in desktop, File System Access API in browser

const isElectron = typeof window !== 'undefined' && !!window.electronAPI
const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

// Desktop URL prefix for local images embedded in the editor.
// Under Tauri (WebView2) custom protocols are served over http://<scheme>.localhost;
// under Electron the raw custom scheme works directly.
export const IMG_BASE = isTauri ? 'http://local-image.localhost/img/' : 'local-image://img/'

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
      if (name.endsWith('.assets')) {
        // Register .assets dir + image files inside for blob URL access (hidden from tree)
        fileHandles.set(path, handle)
        for await (const [imgName, imgHandle] of handle.entries()) {
          if (imgHandle.kind === 'file') fileHandles.set(`${path}/${imgName}`, imgHandle)
        }
        continue
      }
      fileHandles.set(path, handle)  // register so subfolders are resolvable
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
    openPath:         target       => api.openPath(target).catch(e => ({ success: false, error: String(e?.message || e) })),
    createFolder:     dirPath      => wrap(api.createFolder(dirPath)),
    renameFile:       (o, n)       => wrap(api.renameFile(o, n)),
    saveImage:        (dir, name, b64) => wrap(api.saveImage(dir, name, b64)),
    cleanupImages:    (dir, refs)  => wrap(api.cleanupImages(dir, refs)),
    copyAssets:       (src, dest)  => wrap(api.copyAssets(src, dest)),
    readImageBase64:  (path)       => wrap(api.readImageBase64(path)),
    openScheduleWindow: (content, fileName) => api.openScheduleWindow(content, fileName),
    openSpecWindow: (content, fileName) => api.openSpecWindow(content, fileName),
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
      let handle = await resolveHandle(path, 'readwrite')
      if (!handle) {
        const normalPath = path.replace(/\\/g, '/')
        const parts = normalPath.split('/')
        const fileName = parts.pop()
        const parentPath = parts.join('/')
        const parentHandle = await resolveHandle(parentPath, 'readwrite')
        if (!parentHandle) throw new Error('파일 핸들을 찾을 수 없습니다')
        handle = await parentHandle.getFileHandle(fileName, { create: true })
        regFile(normalPath, handle)
      }
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

    // 웹 환경에서는 보안상 로컬 경로를 열 수 없다.
    openPath: async () => ({ success: false, error: '웹 환경에서는 로컬 폴더를 열 수 없습니다' }),

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

    createFolder: async (dirPath) => {
      const parts = dirPath.replace(/\\/g, '/').split('/')
      const folderName = parts.pop()
      const parentPath = parts.join('/')
      const parentHandle = await resolveHandle(parentPath, 'readwrite')
      if (!parentHandle) throw new Error('상위 디렉토리를 찾을 수 없습니다. 폴더를 먼저 열어주세요.')
      const newHandle = await parentHandle.getDirectoryHandle(folderName, { create: true })
      regFile(dirPath.replace(/\\/g, '/'), newHandle)
    },

    renameFile: async () => {
      throw new Error('웹 환경에서는 파일 이름 변경을 지원하지 않습니다')
    },

    saveImage: async (assetsDir, fileName, base64Data) => {
      // assetsDir: 'notebookRoot/subdir/filename.assets'
      const parts = assetsDir.split('/')
      const assetsDirName = parts.pop()
      const parentPath = parts.join('/')
      const parentHandle = await resolveHandle(parentPath, 'readwrite')
      if (!parentHandle) throw new Error('디렉토리를 찾을 수 없습니다. 폴더를 먼저 열어주세요.')
      // Create or get .assets directory
      const assetsDirHandle = await parentHandle.getDirectoryHandle(assetsDirName, { create: true })
      fileHandles.set(assetsDir, assetsDirHandle)
      // Write image file
      const fileHandle = await assetsDirHandle.getFileHandle(fileName, { create: true })
      fileHandles.set(`${assetsDir}/${fileName}`, fileHandle)
      const binary = atob(base64Data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const writable = await fileHandle.createWritable()
      await writable.write(bytes.buffer)
      await writable.close()
      return { success: true }
    },

    cleanupImages: async (assetsDir, referencedImages) => {
      const handle = await resolveHandle(assetsDir, 'readwrite')
      if (!handle) return { deleted: [] }
      const deleted = []
      const refSet = new Set(referencedImages)
      const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
      for await (const [name] of handle.entries()) {
        const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
        if (imageExts.has(ext) && !refSet.has(name)) {
          try {
            await handle.removeEntry(name)
            fileHandles.delete(`${assetsDir}/${name}`)
            deleted.push(name)
          } catch { /* ignore */ }
        }
      }
      return { deleted }
    },
    copyAssets: async () => { throw new Error('웹 환경에서는 이미지 폴더 복사를 지원하지 않습니다') },
    readImageBase64: async () => null,
    openScheduleWindow: (content, fileName) => {
      const base = import.meta.env.BASE_URL || '/';
      const url = base + 'schedule.html';
      const w = window.open(url, 'md-schedule', 'width=1400,height=900');
      if (w) {
        const inject = () => {
          if (content) {
            const el = w.document.getElementById('mdInput');
            if (el) { el.value = content; }
          }
          const h1 = w.document.querySelector('header h1');
          if (h1 && fileName) h1.textContent = fileName;
          if (typeof w.render === 'function') w.render(w.currentMode || 'fit');
        };
        // 이미 로드된 창이면 바로 주입, 아니면 load 이벤트 대기
        if (w.document.readyState === 'complete' && w.document.getElementById('mdInput')) {
          inject();
          w.focus();
        } else {
          w.addEventListener('load', inject);
        }
      }
      return Promise.resolve();
    },
    openSpecWindow: () => {
      // Content is delivered over the 'md-spec-sync' BroadcastChannel: the viewer
      // requests it on load (and on reload), and App.jsx responds. This keeps the
      // content alive across browser refreshes without re-injection.
      const base = import.meta.env.BASE_URL || '/';
      const url = base + 'specviewer.html?embed=1';
      const w = window.open(url, 'md-specviewer', 'width=1400,height=900');
      if (w) w.focus();
      return Promise.resolve();
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
export const openPath         = impl.openPath
export const createFolder     = impl.createFolder
export const renameFile       = impl.renameFile
export const saveImage        = impl.saveImage
export const cleanupImages    = impl.cleanupImages
export const copyAssets          = impl.copyAssets
export const readImageBase64     = impl.readImageBase64
export const openScheduleWindow  = (content, fileName) => impl.openScheduleWindow(content, fileName)
export const openSpecWindow      = (content, fileName) => impl.openSpecWindow(content, fileName)

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

// Web only: read an image file handle and return a blob URL
export async function readImageAsBlob(path) {
  if (isElectron) return null
  const handle = await resolveHandle(path, 'read')
  if (!handle) return null
  const file = await handle.getFile()
  return URL.createObjectURL(file)
}
