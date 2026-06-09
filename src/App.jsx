import React, { useState, useCallback, useEffect, useRef } from 'react'
import FileTree from './components/FileTree'
import TocPanel from './components/TocPanel'
import Editor from './components/Editor'
import HtmlEditor from './components/HtmlEditor'
import MarkdownPreview from './components/MarkdownPreview'
import SaveAsModal from './components/SaveAsModal'
import StatusBar from './components/StatusBar'
import SettingsMenu from './components/SettingsMenu'
import { readFile, writeFile, saveDialog, pickAndReadFile, isWeb, cleanupImages, checkExists, copyAssets, openSpecWindow } from './api'
import { exportHtml } from './utils/htmlExport'
import { normalizeHtmlTables, makeHeadingId } from './utils/mdRenderer'
import specTemplate from './templates/spec-template.md?raw'
import changelogTemplate from './templates/changelog-template.md?raw'

export default function App() {
  const [rootDir, setRootDir] = useState('')
  const [currentFile, setCurrentFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [autoSave, setAutoSave] = useState(true)
  const [saveStatus, setSaveStatus] = useState('saved')
  const [wordCount, setWordCount] = useState(0)
  const [headings, setHeadings] = useState([])
  const [showSaveAs, setShowSaveAs] = useState(false)
  // Bumped whenever a new/template doc is loaded so the (path-less) editor remounts
  // and picks up the new initialContent even when staying on an untitled doc.
  const [newDocNonce, setNewDocNonce] = useState(0)

  // Toolbar feature toggles (gear menu in the status bar). Defaults: Spec Viewer on,
  // Template off, Schedule on. User changes are persisted and override the defaults.
  const [toolbarPrefs, setToolbarPrefs] = useState(() => {
    const defaults = { showSchedule: true, showSpecViewer: false, showTemplate: false }
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem('mdeditor-toolbar-prefs') || '{}') }
    } catch {
      return defaults
    }
  })
  const toggleToolbarPref = useCallback((key) => {
    setToolbarPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem('mdeditor-toolbar-prefs', JSON.stringify(next))
      return next
    })
  }, [])
  const [isDragOver, setIsDragOver] = useState(false)

  const [sidebarSplit, setSidebarSplit] = useState(60) // file-tree height %
  const [showPreview, setShowPreview] = useState(false)
  const [previewSplit, setPreviewSplit] = useState(50)  // editor width %
  const [scheduleSplit, setScheduleSplit] = useState(false)
  const [scheduleSplitRatio, setScheduleSplitRatio] = useState(55) // editor side %
  const [recentFiles, setRecentFiles] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('md-viewer-recent') || '[]')
      return saved.sort((a, b) => b.openedAt - a.openedAt)   // 앱 시작 시 최신 순 정렬
    }
    catch { return [] }
  })

  const [projects, setProjects] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('md-viewer-notebooks') || '[]')
    }
    catch { return [] }
  })

  const handleProjectsChange = useCallback((updated) => {
    setProjects(updated)
    localStorage.setItem('md-viewer-notebooks', JSON.stringify(updated))
  }, [])

  const isHtml = currentFile?.name.endsWith('.html') || currentFile?.name.endsWith('.htm')

  const contentRef = useRef('')
  const currentFileRef = useRef(null)
  const editorRef = useRef(null)
  const htmlEditorRef = useRef(null)
  const fileTreeRef = useRef(null)
  const selectedFolderPathRef = useRef(null)
  const previewBodyRef = useRef(null)

  const handleFolderSelect = useCallback((folderPath) => {
    selectedFolderPathRef.current = folderPath
  }, [])
  const sidebarRef = useRef(null)
  const mainRef = useRef(null)
  const isDraggingDivider = useRef(false)
  const isDraggingPreview = useRef(false)
  const isDraggingSchedule = useRef(false)
  const specChannelRef = useRef(null)
  contentRef.current = fileContent
  currentFileRef.current = currentFile

  // ── Schedule split drag ───────────────────────────────────
  const handleScheduleDividerMouseDown = useCallback((e) => {
    e.preventDefault()
    isDraggingSchedule.current = true
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    // iframe이 mousemove를 가로채지 못하도록 차단
    const iframes = document.querySelectorAll('iframe')
    iframes.forEach(f => f.style.pointerEvents = 'none')
    const onMouseMove = (e) => {
      if (!isDraggingSchedule.current || !mainRef.current) return
      const rect = mainRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setScheduleSplitRatio(Math.max(25, Math.min(75, pct)))
    }
    const onMouseUp = () => {
      isDraggingSchedule.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      iframes.forEach(f => f.style.pointerEvents = '')
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  // ── Spec split drag ───────────────────────────────────────
  const handleOpenScheduleSplit = useCallback(() => {
    setScheduleSplit(true)
  }, [])

  const handleCloseScheduleSplit = useCallback(() => {
    setScheduleSplit(false)
  }, [])

  // ── Spec Viewer (new window only) ──────────────────────────
  const unescapeMd = (s) => (s || '').replace(/\\([\[\]~*_`|\\<>])/g, '$1')

  // The spec window pulls content over this channel — so it survives a browser
  // reload (the window re-requests on load) and the 새로고침 button is just reload().
  const ensureSpecChannel = useCallback(() => {
    if (specChannelRef.current) return
    const ch = new BroadcastChannel('md-spec-sync')
    ch.onmessage = (e) => {
      if (e.data?.type === 'spec-md-request') {
        const md = unescapeMd(contentRef.current)
        const fn = currentFileRef.current?.name?.replace(/\.[^.]+$/, '') || 'spec'
        ch.postMessage({ type: 'spec-md-update', md, filename: fn })
      }
    }
    specChannelRef.current = ch
  }, [])

  const handleOpenSpecWindow = useCallback(() => {
    ensureSpecChannel()
    const md = unescapeMd(contentRef.current)
    const fn = currentFileRef.current?.name?.replace(/\.[^.]+$/, '') || 'spec'
    openSpecWindow(md, fn)
  }, [ensureSpecChannel])

  // 파일 전환 시 스케줄 스플릿 자동 닫기
  useEffect(() => {
    setScheduleSplit(false)
  }, [currentFile])

  // ── Preview resize drag ───────────────────────────────────
  const handlePreviewDividerMouseDown = useCallback((e) => {
    e.preventDefault()
    isDraggingPreview.current = true
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e) => {
      if (!isDraggingPreview.current || !mainRef.current) return
      const rect = mainRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setPreviewSplit(Math.max(25, Math.min(75, pct)))
    }
    const onMouseUp = () => {
      isDraggingPreview.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  // ── Sidebar resize drag ────────────────────────────────────
  const handleDividerMouseDown = useCallback((e) => {
    e.preventDefault()
    isDraggingDivider.current = true
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e) => {
      if (!isDraggingDivider.current || !sidebarRef.current) return
      const rect = sidebarRef.current.getBoundingClientRect()
      const pct = ((e.clientY - rect.top) / rect.height) * 100
      setSidebarSplit(Math.max(15, Math.min(85, pct)))
    }
    const onMouseUp = () => {
      isDraggingDivider.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  // ── Recent files ───────────────────────────────────────────
  const addToRecent = useCallback((file) => {
    setRecentFiles(prev => {
      const exists = prev.some(f => f.path === file.path)
      if (exists) {
        // 이미 목록에 있으면 순서 유지, timestamp만 갱신
        const updated = prev.map(f =>
          f.path === file.path ? { ...f, openedAt: Date.now() } : f
        )
        localStorage.setItem('md-viewer-recent', JSON.stringify(updated))
        return updated
      }
      // 새 파일이면 맨 위에 추가
      const updated = [{ path: file.path, name: file.name, openedAt: Date.now() }, ...prev].slice(0, 20)
      localStorage.setItem('md-viewer-recent', JSON.stringify(updated))
      return updated
    })
  }, [])

  const handleFileRenamed = useCallback((oldPath, newPath, newName) => {
    // 현재 열린 파일이면 경로 갱신
    if (currentFileRef.current?.path === oldPath) {
      setCurrentFile({ path: newPath, name: newName })
      document.title = `${newName} — Hi MD Editor`
    }
    // 최근 문서 목록에서도 경로 갱신
    setRecentFiles(prev => {
      const updated = prev.map(f =>
        f.path === oldPath ? { ...f, path: newPath, name: newName } : f
      )
      localStorage.setItem('md-viewer-recent', JSON.stringify(updated))
      return updated
    })
  }, [])

  const removeFromRecent = useCallback((path) => {
    setRecentFiles(prev => {
      const updated = prev.filter(f => f.path !== path)
      localStorage.setItem('md-viewer-recent', JSON.stringify(updated))
      return updated
    })
  }, [])

  // ── Image cleanup helper ────────────────────────────────
  const runImageCleanup = useCallback(async (filePath, markdown) => {
    if (!filePath) return
    const baseName = filePath.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '')
    const assetsDir = filePath.replace(/\\/g, '/').replace(/\/[^/]+$/, '') + '/' + baseName + '.assets'
    // Extract all referenced image filenames from markdown
    const imgRegex = /!\[.*?\]\(\.\/(.*?\.assets\/([^)]+))\)/g
    const referenced = []
    let m
    while ((m = imgRegex.exec(markdown)) !== null) {
      if (m[1].startsWith(baseName + '.assets/')) referenced.push(m[2])
    }
    try { await cleanupImages(assetsDir, referenced) } catch { /* ignore */ }
  }, [])

  // ── Save ───────────────────────────────────────────────────
  const handleSave = useCallback(async (overridePath, { isManual = false } = {}) => {
    const file = currentFileRef.current
    // Safety net: autosave must NEVER silently blank out an existing file (guards
    // against undo glitches / data loss). Clearing a file requires an explicit save.
    if (!isManual && file?.path && !contentRef.current.trim()) return
    let savePath = overridePath || file?.path
    if (!savePath) {
      // 노트북 탭에서 폴더를 선택한 상태면 그 폴더를 기본 경로로 사용
      const folderHint = selectedFolderPathRef.current
      const defaultPath = folderHint
        ? folderHint.replace(/\\/g, '/') + '/untitled.md'
        : null
      const newPath = await saveDialog(defaultPath)
      if (!newPath) return
      savePath = newPath
    }

    try {
      setSaveStatus('saving')

      // Auto-normalize broken HTML tables to valid Markdown on every save (.md only)
      const isMarkdown = !file?.name?.endsWith('.html') && !file?.name?.endsWith('.htm')
      let contentToSave = contentRef.current
      let wasNormalized = false
      if (isMarkdown && /<table[\s\S]*?<\/table>/i.test(contentToSave)) {
        const normalized = normalizeHtmlTables(contentToSave)
        if (normalized !== contentToSave) {
          contentToSave = normalized
          contentRef.current = normalized
          wasNormalized = true
        }
      }

      await writeFile(savePath, contentToSave)
      setSaveStatus('saved')

      // Sync editor display to show cleaned-up content (without marking as 'modified')
      if (wasNormalized) {
        setFileContent(contentToSave)
        editorRef.current?.applyNormalized(contentToSave)
      }

      // Manual save → clean up orphan images
      if (isManual) await runImageCleanup(savePath, contentRef.current)

      if (savePath !== file?.path) {
        const name = savePath.replace(/\\/g, '/').split('/').pop()
        const updated = { path: savePath, name }
        setCurrentFile(updated)
        addToRecent(updated)
        document.title = `${name} — Hi MD Editor`
      }
    } catch (err) {
      setSaveStatus('error')
      alert(`저장 실패: ${err.message}`)
    }
  }, [addToRecent])

  // ── File open ──────────────────────────────────────────────
  const handleFileSelect = useCallback(async (file) => {
    // 같은 파일 클릭 시 무시
    if (file.path === currentFileRef.current?.path) return

    // 미저장 변경사항 처리
    if (saveStatus === 'modified' && currentFileRef.current) {
      if (autoSave) {
        await handleSave()
      } else {
        const confirmed = window.confirm(
          `"${currentFileRef.current.name}"에 저장하지 않은 변경사항이 있습니다.\n저장하고 전환하시겠습니까?`
        )
        if (confirmed) await handleSave()
        // 취소(false)면 변경사항 버리고 전환
      }
    }

    // 파일 전환 시 이전 파일의 고아 이미지 정리
    if (currentFileRef.current?.path) {
      await runImageCleanup(currentFileRef.current.path, contentRef.current)
    }

    try {
      setFileLoading(true)
      const { content } = await readFile(file.path)
      setCurrentFile(file)
      setFileContent(content)
      setSaveStatus('saved')
      document.title = `${file.name} — Hi MD Editor`
      addToRecent({ path: file.path, name: file.name })
    } catch (err) {
      alert(`파일을 열 수 없습니다: ${err.message}`)
    } finally {
      setFileLoading(false)
    }
  }, [saveStatus, autoSave, handleSave, addToRecent])

  // Native Save As dialog via Electron
  const handleSaveAs = useCallback(async () => {
    const currentPath = currentFileRef.current?.path
    const newPath = await saveDialog(currentPath)
    if (!newPath) return

    // Check for .assets folder and offer to copy (Electron only, full paths available)
    if (!isWeb && currentPath) {
      const base = currentPath.replace(/\\/g, '/').replace(/\.[^.]+$/, '')
      const assetsDir = `${base}.assets`
      const hasAssets = await checkExists(assetsDir)
      if (hasAssets) {
        const assetsFolderName = assetsDir.split('/').pop()
        const confirmed = window.confirm(
          `이 파일에 이미지 폴더(${assetsFolderName})가 있습니다.\n\n새 위치에 함께 복사하시겠습니까?`
        )
        if (confirmed) {
          const newBase = newPath.replace(/\\/g, '/').replace(/\.[^.]+$/, '')
          const destAssets = `${newBase}.assets`
          try {
            await copyAssets(assetsDir, destAssets)
          } catch (err) {
            alert(`이미지 폴더 복사 실패: ${err.message}`)
          }
        }
      }
    }

    handleSave(newPath)
  }, [handleSave])

  // ── HTML Export ────────────────────────────────────────────
  const handleExportHtml = useCallback(async () => {
    if (!currentFile) return
    try {
      await exportHtml({
        content: contentRef.current,
        title: currentFile.name,
        headings,
        filePath: currentFile.path,
      })
    } catch (err) {
      alert(`HTML 내보내기 실패: ${err.message}`)
    }
  }, [currentFile, headings])

  // ── New file ───────────────────────────────────────────────
  const handleNewFile = useCallback(async () => {
    if (saveStatus === 'modified') {
      const hasSavedPath = !!currentFileRef.current?.path
      if (hasSavedPath && autoSave) {
        await handleSave()
      } else {
        const name = currentFileRef.current?.name || 'Untitled.md'
        const msg = hasSavedPath
          ? `"${name}"에 저장하지 않은 변경사항이 있습니다.\n저장하고 새 파일을 만드시겠습니까?`
          : '저장하지 않은 내용이 있습니다. 새 파일을 만들면 사라집니다.\n계속하시겠습니까?'
        const confirmed = window.confirm(msg)
        if (!confirmed) return
        if (hasSavedPath) await handleSave()
      }
    }
    setNewDocNonce(n => n + 1)
    setCurrentFile({ path: null, name: 'Untitled.md' })
    setFileContent('')
    setSaveStatus('saved')
    setHeadings([])
    document.title = 'Untitled.md — Hi MD Editor'
  }, [saveStatus, autoSave, handleSave])

  // ── Insert a template at the TOP of the current document ───
  // The existing content is kept below, separated by a horizontal rule.
  const handleLoadTemplate = useCallback((kind) => {
    const tpl = kind === 'changelog' ? changelogTemplate : specTemplate
    const current = (contentRef.current || '').trim()
    const merged = current ? `${tpl.trim()}\n\n---\n\n${current}\n` : `${tpl.trim()}\n`
    // Keep the current file (path/name) — just prepend. Bump the nonce so the editor
    // remounts and picks up the merged content even when the path is unchanged.
    setNewDocNonce(n => n + 1)
    setFileContent(merged)
    setSaveStatus('modified')
  }, [])

  // ── Content change from editor ─────────────────────────────
  const specPushTimerRef = useRef(null)
  const handleContentChange = useCallback((markdown, words) => {
    setFileContent(markdown)
    setWordCount(words)
    setSaveStatus('modified')
    // Live-push edits to an open Spec window (debounced) so it reflects changes
    // without needing a manual refresh.
    if (specChannelRef.current) {
      clearTimeout(specPushTimerRef.current)
      specPushTimerRef.current = setTimeout(() => {
        const fn = currentFileRef.current?.name?.replace(/\.[^.]+$/, '') || 'spec'
        specChannelRef.current?.postMessage({ type: 'spec-md-update', md: unescapeMd(markdown), filename: fn })
      }, 500)
    }
  }, [])

  // ── Heading navigation ─────────────────────────────────────
  const handleHeadingClick = useCallback((heading) => {
    // heading is { pos, text, level } from TocPanel
    if (isHtml) {
      // For HTML files, pos = heading index; scroll the HtmlEditor iframe
      htmlEditorRef.current?.scrollToHeading(heading.pos)
    } else {
      editorRef.current?.scrollToPos(heading.pos)
      // Also scroll the preview pane when split view is active
      if (showPreview && previewBodyRef.current) {
        const el = previewBodyRef.current.querySelector(`#${makeHeadingId(heading.text)}`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [isHtml, showPreview])

  // ── Open file passed via command-line / file association ──
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    // Poll once for a path that was passed before the renderer loaded
    api.getOpenFilePath().then(filePath => {
      if (filePath) handleFileSelect({ path: filePath, name: filePath.replace(/\\/g, '/').split('/').pop() })
    })
    // Also handle future open-file events (e.g. already-running instance)
    const removeListener = api.onOpenFile((filePath) => {
      if (filePath) handleFileSelect({ path: filePath, name: filePath.replace(/\\/g, '/').split('/').pop() })
    })
    return removeListener
  }, [handleFileSelect])

  // ── Auto-save debounce ─────────────────────────────────────
  useEffect(() => {
    if (!autoSave || saveStatus !== 'modified' || !currentFile?.path) return
    const timer = setTimeout(() => handleSave(), 2000)
    return () => clearTimeout(timer)
  }, [fileContent, autoSave, saveStatus, currentFile, handleSave])

  // ── Keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === 'n') {
        e.preventDefault()
        handleNewFile()
      }
      if (e.key === 's') {
        e.preventDefault()
        if (e.shiftKey) handleSaveAs()
        else handleSave(undefined, { isManual: true })
      }
      if (e.key === 'f') {
        e.preventDefault()
        if (currentFile) editorRef.current?.openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave, handleSaveAs, handleNewFile, currentFile])

  // ── Drag & Drop ────────────────────────────────────────────
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    const hasFiles = [...(e.dataTransfer.items || [])].some(i => i.kind === 'file')
    if (hasFiles) setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setIsDragOver(false)
    if (isWeb) {
      // Web: use DataTransferItem.getAsFileSystemHandle()
      const items = [...(e.dataTransfer.items || [])]
      for (const item of items) {
        if (item.kind !== 'file') continue
        const handle = await item.getAsFileSystemHandle?.()
        if (!handle || handle.kind !== 'file') continue
        if (!handle.name.endsWith('.md') && !handle.name.endsWith('.html')) continue
        const { registerFileHandle } = await import('./api')
        registerFileHandle(handle.name, handle)
        const file = await handle.getFile()
        const content = await file.text()
        await handleFileSelect({ path: handle.name, name: handle.name }, content)
        return
      }
    } else {
      const files = [...(e.dataTransfer.files || [])]
      const file = files.find(f => f.name.endsWith('.md') || f.name.endsWith('.html'))
      if (file) {
        await handleFileSelect({ path: file.path, name: file.name })
        const parentDir = file.path.split(/[\\/]/).slice(0, -1).join('\\')
        if (parentDir) fileTreeRef.current?.loadDir(parentDir)
      }
    }
  }, [handleFileSelect])

  return (
    <div
      className="app"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-title">
          <svg width="22" height="22" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <rect x="64" y="32" width="352" height="440" rx="48" fill="#F0FAF0"/>
            <rect x="64" y="32" width="352" height="440" rx="48" fill="none" stroke="#82C982" strokeWidth="20"/>
            <path d="M356 32 L416 92 L356 92 Z" fill="#F0FAF0"/>
            <path d="M356 32 L356 92 L416 92" fill="none" stroke="#82C982" strokeWidth="20" strokeLinejoin="round"/>
            <circle cx="196" cy="200" r="22" fill="#2E4A2E"/>
            <circle cx="316" cy="200" r="22" fill="#2E4A2E"/>
            <path d="M180 248 Q256 316 332 248" stroke="#2E4A2E" strokeWidth="22" strokeLinecap="round" fill="none"/>
            <text x="240" y="430" fontSize="108" fontWeight="800" fontFamily="'Helvetica Neue',Arial,sans-serif" textAnchor="middle" fill="#2E4A2E">md</text>
          </svg>
          Hi MD Editor
        </div>

        <div className="header-actions">
          <div className="autosave-row">
            <span className="autosave-label">Auto Save</span>
            <button
              className={`toggle-btn ${autoSave ? 'on' : 'off'}`}
              onClick={() => setAutoSave(v => !v)}
            >
              <span className="toggle-knob" />
            </button>
            <span className={`autosave-state ${autoSave ? 'on' : 'off'}`}>
              {autoSave ? 'ON' : 'OFF'}
            </span>
          </div>

          <button
            className={`btn btn-view ${showPreview ? 'active' : ''}`}
            onClick={() => setShowPreview(v => !v)}
            disabled={!currentFile || isHtml}
            title="뷰 모드 (목차 + 미리보기)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
            View
          </button>
          <button className="btn btn-new" onClick={handleNewFile} title="새 파일 (Ctrl+N)">
            New
          </button>
          <button className="btn btn-save" onClick={() => handleSave()} disabled={!currentFile || saveStatus !== 'modified'}>
            Save
          </button>
          <button className="btn btn-saveas" onClick={handleSaveAs} disabled={!currentFile}>
            Save As…
          </button>
          <button className="btn btn-saveas" onClick={handleExportHtml} disabled={!currentFile || isHtml} title="HTML 파일로 내보내기">
            HTML↓
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="app-body">
        <aside className="sidebar" ref={sidebarRef}>
          {/* File tree pane */}
          <div
            className="sidebar-pane"
            style={{ height: `${sidebarSplit}%` }}
          >
            <FileTree
              ref={fileTreeRef}
              rootDir={rootDir}
              onRootDirChange={setRootDir}
              currentFile={currentFile}
              onFileSelect={handleFileSelect}
              onFileRenamed={handleFileRenamed}
              saveStatus={saveStatus}
              recentFiles={recentFiles}
              onRemoveRecent={removeFromRecent}
              projects={projects}
              onProjectsChange={handleProjectsChange}
              onFolderSelect={handleFolderSelect}
            />
          </div>

          {/* Drag divider + TOC — always visible */}
          <div
            className="sidebar-divider"
            onMouseDown={handleDividerMouseDown}
            title="드래그하여 크기 조절"
          />
          <div className="sidebar-pane" style={{ height: `${100 - sidebarSplit}%` }}>
            <TocPanel headings={headings} onHeadingClick={handleHeadingClick} markdown={fileContent} />
          </div>
        </aside>

        <main className="editor-area" ref={mainRef}>
          {/* Drag overlay */}
          {isDragOver && (
            <div className="drag-overlay">
              <div className="drag-message">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14,2 14,8 20,8"/>
                </svg>
                <p>.md / .html 파일을 여기에 놓으세요</p>
              </div>
            </div>
          )}

          {/* Editor panel */}
          <div
            className="editor-panel"
            style={
              scheduleSplit && currentFile && !isHtml
                ? { width: `${scheduleSplitRatio}%`, flex: 'none' }
                : showPreview && currentFile && !isHtml
                  ? { width: `${previewSplit}%`, flex: 'none' }
                  : undefined
            }
          >
            {fileLoading ? (
              <div className="loading">
                <div className="spinner" />
                <span>불러오는 중…</span>
              </div>
            ) : currentFile ? (
              isHtml ? (
                <HtmlEditor
                  ref={htmlEditorRef}
                  key={currentFile.path}
                  initialContent={fileContent}
                  onContentChange={handleContentChange}
                  onHeadingsChange={setHeadings}
                />
              ) : (
                <Editor
                  ref={editorRef}
                  key={`${currentFile.path || '__new__'}#${newDocNonce}`}
                  initialContent={fileContent}
                  onContentChange={handleContentChange}
                  onHeadingsChange={setHeadings}
                  onSave={handleSave}
                  currentFilePath={currentFile.path}
                  onOpenScheduleSplit={handleOpenScheduleSplit}
                  onOpenSpecWindow={handleOpenSpecWindow}
                  onLoadTemplate={handleLoadTemplate}
                  toolbarPrefs={toolbarPrefs}
                />
              )
            ) : (
              <div className="welcome">
                <div className="welcome-icon">
                  <svg width="80" height="80" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                    <rect x="64" y="32" width="352" height="440" rx="48" fill="#F0FAF0"/>
                    <rect x="64" y="32" width="352" height="440" rx="48" fill="none" stroke="#82C982" strokeWidth="20"/>
                    <path d="M356 32 L416 92 L356 92 Z" fill="#F0FAF0"/>
                    <path d="M356 32 L356 92 L416 92" fill="none" stroke="#82C982" strokeWidth="20" strokeLinejoin="round"/>
                    <circle cx="196" cy="200" r="22" fill="#2E4A2E"/>
                    <circle cx="316" cy="200" r="22" fill="#2E4A2E"/>
                    <path d="M180 248 Q256 316 332 248" stroke="#2E4A2E" strokeWidth="22" strokeLinecap="round" fill="none"/>
                    <text x="240" y="430" fontSize="108" fontWeight="800" fontFamily="'Helvetica Neue',Arial,sans-serif" textAnchor="middle" fill="#2E4A2E">md</text>
                  </svg>
                </div>
                <h2>Hi MD Editor</h2>
                <p>왼쪽에서 폴더를 열거나<br/>.md · .html 파일을 여기로 드래그하세요.</p>
                {isWeb && (
                  <button
                    className="btn btn-save"
                    style={{ marginTop: 16 }}
                    onClick={async () => {
                      const result = await pickAndReadFile()
                      if (result) {
                        const file = { path: result.path, name: result.name }
                        setCurrentFile(file)
                        setFileContent(result.content)
                        setSaveStatus('saved')
                        document.title = `${result.name} — Hi MD Editor`
                        addToRecent(file)
                      }
                    }}
                  >
                    파일 열기
                  </button>
                )}
                <div className="welcome-shortcuts">
                  <span><kbd>Ctrl+N</kbd> 새 파일</span>
                  <span className="welcome-shortcuts-sep">·</span>
                  <span><kbd>Ctrl+S</kbd> 저장</span>
                  <span className="welcome-shortcuts-sep">·</span>
                  <span><kbd>Ctrl+Shift+S</kbd> 다른 이름으로 저장</span>
                </div>
              </div>
            )}
          </div>

          {/* Preview panel (split view) */}
          {!scheduleSplit && showPreview && currentFile && !isHtml && (
            <>
              <div className="preview-divider" onMouseDown={handlePreviewDividerMouseDown} />
              <div className="preview-panel" style={{ flex: 1 }}>
                <MarkdownPreview
                  content={fileContent}
                  scrollRef={previewBodyRef}
                  currentFilePath={currentFile?.path}
                />
              </div>
            </>
          )}

          {scheduleSplit && (
            <>
              <div className="schedule-split-divider" onMouseDown={handleScheduleDividerMouseDown} />
              <div className="schedule-split-panel" style={{ flex: 1, minWidth: 0 }}>
                <div className="schedule-split-header">
                  <span>스케줄</span>
                  <button className="schedule-split-close" onClick={handleCloseScheduleSplit} title="닫기">✕</button>
                </div>
                <iframe
                  src="./schedule.html"
                  className="schedule-split-iframe"
                  title="스케줄"
                />
              </div>
            </>
          )}
        </main>
      </div>

      <StatusBar
        file={currentFile}
        saveStatus={saveStatus}
        autoSave={autoSave}
        wordCount={wordCount}
        settings={toolbarPrefs}
        onToggleSetting={toggleToolbarPref}
      />
    </div>
  )
}
