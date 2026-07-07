const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, protocol, net } = require('electron')
const fs = require('fs')
const path = require('path')
const { pathToFileURL, fileURLToPath } = require('url')

// Register custom protocol for local image access
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-image', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, standard: true, secure: true } }
])

// Use NODE_ENV (set by cross-env in dev script) rather than app.isPackaged,
// because isPackaged is not reliable at module-evaluation time.
const isDev = process.env.NODE_ENV === 'development'

// ── File path from command-line (file association) ─────────
function getArgFilePath(argv = process.argv) {
  // Skip argv[0] (electron/exe). Find first existing .md/.html arg.
  return argv.slice(1).find(a =>
    /\.(md|html?)$/i.test(a) && fs.existsSync(a)
  ) || null
}
let pendingOpenPath = getArgFilePath()

// ── Single-instance lock ───────────────────────────────────
// 앱을 두 번째로 실행하면 새 프로세스를 띄우지 않고, 이미 실행 중인
// 프로세스 안에서 새 창을 연다. 이렇게 하면 모든 창이 같은 프로세스를
// 공유하므로 최근 문서·노트북 등의 localStorage 변경이 'storage'
// 이벤트로 다른 창에 즉시 전파된다. (App.jsx의 동기화 코드 참고)
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // 두 번째 실행이 파일 경로를 들고 왔으면 그 파일을 열며 새 창을 띄운다.
    pendingOpenPath = getArgFilePath(argv)
    createWindow()
  })
}

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
    title: 'Hi MD Editor',
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

  // Open external links (http/https) in the default OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
}

app.whenReady().then(() => {
  // Register protocol handler for local images
  // URL format: local-image://img/E:/path/to/file.png (dummy host 'img')
  protocol.handle('local-image', (request) => {
    const parsed = new URL(request.url)
    let filePath = decodeURIComponent(parsed.pathname)
    // Windows: remove leading slash from /E:/...
    if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:/)) filePath = filePath.slice(1)
    if (!fs.existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }
    const data = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' }
    return new Response(data, { headers: { 'Content-Type': mime[ext] || 'application/octet-stream' } })
  })
  createWindow()
})
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
        // Hide .assets image folders and non-md/html files
        if (isDir && name.endsWith('.assets')) return null
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

// 문서 안의 로컬 폴더/파일 경로(예: E:\path\to\folder, \\server\share, file://)를 OS에서 연다.
// 폴더면 탐색기로 열리고, 파일이면 연결된 기본 앱으로 열린다.
ipcMain.handle('open-path', async (_, target) => {
  try {
    if (typeof target !== 'string' || !target.trim()) return { success: false, error: 'empty path' }
    let p = target.trim()
    if (/^file:\/\//i.test(p)) { try { p = fileURLToPath(p) } catch { /* keep as-is */ } }
    const err = await shell.openPath(path.resolve(p))
    return err ? { success: false, error: err } : { success: true }
  } catch (e) {
    return { success: false, error: String((e && e.message) || e) }
  }
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

ipcMain.handle('create-folder', (_, dirPath) => {
  const resolved = path.resolve(dirPath)
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true })
  }
  return { success: true, path: resolved }
})

ipcMain.handle('rename-file', (_, oldPath, newPath) => {
  const resolvedOld = path.resolve(oldPath)
  const resolvedNew = path.resolve(newPath)
  if (!fs.existsSync(resolvedOld)) throw new Error('파일을 찾을 수 없습니다')
  if (fs.existsSync(resolvedNew)) throw new Error('같은 이름의 파일이 이미 존재합니다')
  fs.renameSync(resolvedOld, resolvedNew)
  return { success: true, oldPath: resolvedOld, newPath: resolvedNew }
})

ipcMain.handle('save-image', (_, dirPath, fileName, base64Data) => {
  const resolved = path.resolve(dirPath)
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true })
  const filePath = path.join(resolved, fileName)
  const buffer = Buffer.from(base64Data, 'base64')
  fs.writeFileSync(filePath, buffer)
  return { success: true, path: filePath }
})

ipcMain.handle('cleanup-images', (_, assetsDir, referencedImages) => {
  const resolved = path.resolve(assetsDir)
  if (!fs.existsSync(resolved)) return { deleted: [] }
  const allFiles = fs.readdirSync(resolved)
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
  const refSet = new Set(referencedImages)
  const deleted = []
  for (const file of allFiles) {
    const ext = path.extname(file).toLowerCase()
    if (imageExts.has(ext) && !refSet.has(file)) {
      fs.unlinkSync(path.join(resolved, file))
      deleted.push(file)
    }
  }
  // 폴더가 비었으면 폴더도 삭제
  const remaining = fs.readdirSync(resolved)
  if (remaining.length === 0) fs.rmdirSync(resolved)
  return { deleted }
})

ipcMain.handle('copy-assets', async (_, src, dest) => {
  const srcResolved = path.resolve(src)
  const destResolved = path.resolve(dest)
  if (!fs.existsSync(srcResolved)) throw new Error('원본 폴더를 찾을 수 없습니다')
  await fs.promises.cp(srcResolved, destResolved, { recursive: true })
  return { success: true }
})

ipcMain.handle('read-image-base64', (_, filePath) => {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) return null
  const ext = path.extname(resolved).toLowerCase()
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' }
  const mimeType = mime[ext] || 'application/octet-stream'
  const data = fs.readFileSync(resolved).toString('base64')
  return `data:${mimeType};base64,${data}`
})

// 같은 프로세스 안에서 새 편집기 창을 연다. (localStorage 동기화가 작동하는 방식)
ipcMain.handle('open-new-window', async () => {
  pendingOpenPath = null  // 새 창은 빈 상태로 시작
  createWindow()
})

let scheduleWindow = null;
ipcMain.handle('open-schedule-window', async (event, content, fileName) => {
  // 기존 스케줄 창이 열려있으면 재사용
  if (scheduleWindow && !scheduleWindow.isDestroyed()) {
    scheduleWindow.focus();
    // 콘텐츠 + 파일명 업데이트
    if (content) {
      const safeFileName = (fileName || '스케줄').replace(/'/g, "\\'");
      await scheduleWindow.webContents.executeJavaScript(`
        (function() {
          var el = document.getElementById('mdInput');
          if (el) { el.value = ${JSON.stringify(content)}; }
          var h1 = document.querySelector('header h1');
          if (h1) h1.textContent = '${safeFileName}';
          if (typeof render === 'function') render(typeof currentMode !== 'undefined' ? currentMode : 'fit');
        })();
      `);
    }
    return;
  }
  scheduleWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: '스케줄 뷰어',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  scheduleWindow.on('closed', () => { scheduleWindow = null; });
  if (isDev) {
    await scheduleWindow.loadURL('http://localhost:5174/schedule.html')
  } else {
    await scheduleWindow.loadFile(path.join(__dirname, '../dist/schedule.html'))
  }
  // 로드 완료 후 현재 MD 콘텐츠 + 파일명 직접 주입
  if (content) {
    const safeFileName = (fileName || '스케줄').replace(/'/g, "\\'");
    await scheduleWindow.webContents.executeJavaScript(`
      (function() {
        var el = document.getElementById('mdInput');
        if (el) { el.value = ${JSON.stringify(content)}; }
        var h1 = document.querySelector('header h1');
        if (h1) h1.textContent = '${safeFileName}';
        if (typeof render === 'function') render(typeof currentMode !== 'undefined' ? currentMode : 'fit');
      })();
    `)
  }
})

// ── Spec Viewer window ─────────────────────────────────────
const injectSpec = (content, fileName) => `
  (function() {
    function go() {
      try {
        if (typeof loadSpecFromText !== 'function') return;
        loadSpecFromText(${JSON.stringify(content || '')}, ${JSON.stringify(fileName || 'spec')});
        if (typeof hideStartup === 'function') hideStartup();
        if (typeof render === 'function') render();
        // Replicate the viewer's load() success path so the detail (3rd) panel shows.
        var ca = document.getElementById('ca');
        if (ca) ca.classList.add('panel-open');
        if (typeof initListWidth === 'function') initListWidth();
        if (typeof setPanelWidth === 'function') setPanelWidth(780);
      } catch (e) {}
    }
    // Re-assert a few times — the viewer's own async load() may re-show the
    // startup screen after our first inject.
    go(); setTimeout(go, 250); setTimeout(go, 600);
  })();
`;

let specWindow = null;
let specLast = { content: '', fileName: 'spec' };
ipcMain.handle('open-spec-window', async (event, content, fileName) => {
  specLast = { content: content || '', fileName: fileName || 'spec' };
  // 기존 스펙 뷰어 창이 열려있으면 재사용
  if (specWindow && !specWindow.isDestroyed()) {
    specWindow.focus();
    await specWindow.webContents.executeJavaScript(injectSpec(specLast.content, specLast.fileName));
    return;
  }
  specWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Spec Viewer',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  specWindow.on('closed', () => { specWindow = null; });
  // Re-inject on every load (initial + reload/Cmd+R) so content survives refresh.
  specWindow.webContents.on('did-finish-load', () => {
    specWindow?.webContents.executeJavaScript(injectSpec(specLast.content, specLast.fileName)).catch(() => {});
  });
  if (isDev) {
    await specWindow.loadURL('http://localhost:5174/specviewer.html?embed=1')
  } else {
    await specWindow.loadFile(path.join(__dirname, '../dist/specviewer.html'), { search: 'embed=1' })
  }
})
