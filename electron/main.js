const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron')
const fs = require('fs')
const path = require('path')

// Use NODE_ENV (set by cross-env in dev script) rather than app.isPackaged,
// because isPackaged is not reliable at module-evaluation time.
const isDev = process.env.NODE_ENV === 'development'

// ── File path from command-line (file association) ─────────
function getArgFilePath() {
  // Skip argv[0] (electron/exe). Find first existing .md/.html arg.
  return process.argv.slice(1).find(a =>
    /\.(md|html?)$/i.test(a) && fs.existsSync(a)
  ) || null
}
let pendingOpenPath = getArgFilePath()

// ── Window ─────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, '../build/icon.png')
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    title: 'Hello MD Editor',
    icon: iconPath,
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

  // Send pending file path once renderer is ready
  win.webContents.once('did-finish-load', () => {
    if (pendingOpenPath) {
      win.webContents.send('open-file', pendingOpenPath)
    }
  })
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
        if (!isDir && !name.endsWith('.md') && !name.endsWith('.html')) return null
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
ipcMain.handle('get-open-file-path', () => pendingOpenPath)

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

// Visible-area capture (kept for possible future use)
ipcMain.handle('capture-and-copy', async (event, rect) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const image = await win.webContents.capturePage(rect)
  clipboard.writeImage(image)
  return { success: true }
})

// Full-page capture: renders HTML in a hidden window sized to full content
ipcMain.handle('capture-full-html', async (_, { html, viewWidth, scale = 2 }) => {
  const startWidth = Math.max(viewWidth || 1200, 400)
  const dpr = Math.max(1, Math.min(4, scale)) // clamp 1–4

  const offscreen = new BrowserWindow({
    width: startWidth,
    height: 800,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  try {
    // Load HTML via data URL (self-contained, no server needed)
    await offscreen.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    )

    // Let page fully render (fonts, layout)
    await new Promise(res => setTimeout(res, 500))

    // Hide scrollbars so they don't appear in the captured image
    // Note: must return a serializable value (not a DOM node) from executeJavaScript
    await offscreen.webContents.executeJavaScript(`
      void (() => {
        const s = document.createElement('style');
        s.textContent = '::-webkit-scrollbar{display:none!important}html,body{scrollbar-width:none!important}';
        document.head.appendChild(s);
      })()
    `)

    // Measure full scrollable content size (in CSS px)
    const { sw, sh } = await offscreen.webContents.executeJavaScript(
      '({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight })'
    )

    // Resize hidden window to fit full content
    offscreen.setContentSize(Math.max(sw, 1), Math.max(sh, 1))
    await new Promise(res => setTimeout(res, 150))

    // Apply device scale factor via DevTools Protocol emulation
    offscreen.webContents.enableDeviceEmulation({
      screenPosition: 'desktop',
      screenSize: { width: Math.max(sw, 1), height: Math.max(sh, 1) },
      viewSize:   { width: Math.max(sw, 1), height: Math.max(sh, 1) },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: dpr,
      scale: 1,
    })

    // Settle after emulation
    await new Promise(res => setTimeout(res, 200))

    // Capture full page — resulting image is (sw * dpr) × (sh * dpr) pixels
    const image = await offscreen.webContents.capturePage()
    clipboard.writeImage(image)

    return { success: true }
  } finally {
    offscreen.destroy()
  }
})

ipcMain.handle('reveal-in-explorer', (_, filePath) => {
  shell.showItemInFolder(path.resolve(filePath))
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
