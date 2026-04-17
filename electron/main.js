const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')

// Use NODE_ENV (set by cross-env in dev script) rather than app.isPackaged,
// because isPackaged is not reliable at module-evaluation time.
const isDev = process.env.NODE_ENV === 'development'

// ── Window ─────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    title: 'MD Viewer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  if (isDev) {
    win.loadURL('http://localhost:5174')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── Helpers ────────────────────────────────────────────────
function readDir(dirPath) {
  return fs.readdirSync(dirPath)
    .map(name => {
      const full = path.join(dirPath, name)
      try {
        const stat = fs.statSync(full)
        const isDir = stat.isDirectory()
        if (!isDir && !name.endsWith('.md')) return null
        return { name, path: full, isDirectory: isDir }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

// ── IPC Handlers ───────────────────────────────────────────
ipcMain.handle('list-files', (_, dir) => {
  const resolved = path.resolve(dir)
  if (!fs.existsSync(resolved)) throw new Error('디렉토리를 찾을 수 없습니다')
  if (!fs.statSync(resolved).isDirectory()) throw new Error('폴더가 아닙니다')
  return { items: readDir(resolved), dir: resolved }
})

ipcMain.handle('read-file', (_, filePath) => {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) throw new Error('파일을 찾을 수 없습니다')
  return { content: fs.readFileSync(resolved, 'utf-8'), path: resolved }
})

ipcMain.handle('write-file', (_, filePath, content) => {
  const resolved = path.resolve(filePath)
  const dir = path.dirname(resolved)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(resolved, content, 'utf-8')
  return { success: true, path: resolved }
})

ipcMain.handle('check-exists', (_, filePath) => {
  return fs.existsSync(path.resolve(filePath))
})

ipcMain.handle('open-folder', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: '폴더 열기',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('save-dialog', async (_, defaultPath) => {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showSaveDialog(win, {
    title: '다른 이름으로 저장',
    defaultPath: defaultPath || 'untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  return result.canceled ? null : result.filePath
})
