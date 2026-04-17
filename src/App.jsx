import React, { useState, useCallback, useEffect, useRef } from 'react'
import FileTree from './components/FileTree'
import TocPanel from './components/TocPanel'
import Editor from './components/Editor'
import MarkdownPreview from './components/MarkdownPreview'
import SaveAsModal from './components/SaveAsModal'
import StatusBar from './components/StatusBar'
import { readFile, writeFile, saveDialog, pickAndReadFile, isWeb } from './api'

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
  const [isDragOver, setIsDragOver] = useState(false)

  const [sidebarSplit, setSidebarSplit] = useState(60) // file-tree height %
  const [showPreview, setShowPreview] = useState(false)
  const [previewSplit, setPreviewSplit] = useState(50)  // editor width %
  const [recentFiles, setRecentFiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem('md-viewer-recent') || '[]') }
    catch { return [] }
  })

  const contentRef = useRef('')
  const currentFileRef = useRef(null)
  const editorRef = useRef(null)
  const fileTreeRef = useRef(null)
  const sidebarRef = useRef(null)
  const mainRef = useRef(null)
  const isDraggingDivider = useRef(false)
  const isDraggingPreview = useRef(false)
  contentRef.current = fileContent
  currentFileRef.current = currentFile

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
      const filtered = prev.filter(f => f.path !== file.path)
      const updated = [{ path: file.path, name: file.name, openedAt: Date.now() }, ...filtered].slice(0, 20)
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

  // ── Save ───────────────────────────────────────────────────
  const handleSave = useCallback(async (overridePath) => {
    const file = currentFileRef.current
    const savePath = overridePath || file?.path
    if (!savePath) return

    try {
      setSaveStatus('saving')
      await writeFile(savePath, contentRef.current)
      setSaveStatus('saved')

      if (overridePath && overridePath !== file?.path) {
        const name = overridePath.replace(/\\/g, '/').split('/').pop()
        setCurrentFile({ path: overridePath, name })
        document.title = `${name} — MD Viewer`
      }
    } catch (err) {
      setSaveStatus('error')
      alert(`저장 실패: ${err.message}`)
    }
  }, [])

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

    try {
      setFileLoading(true)
      setHeadings([])
      const { content } = await readFile(file.path)
      setCurrentFile(file)
      setFileContent(content)
      setSaveStatus('saved')
      document.title = `${file.name} — MD Viewer`
      addToRecent({ path: file.path, name: file.name })
    } catch (err) {
      alert(`파일을 열 수 없습니다: ${err.message}`)
    } finally {
      setFileLoading(false)
    }
  }, [saveStatus, autoSave, handleSave, addToRecent])

  // Native Save As dialog via Electron
  const handleSaveAs = useCallback(async () => {
    const newPath = await saveDialog(currentFileRef.current?.path)
    if (newPath) handleSave(newPath)
  }, [handleSave])

  // ── Content change from editor ─────────────────────────────
  const handleContentChange = useCallback((markdown, words) => {
    setFileContent(markdown)
    setWordCount(words)
    setSaveStatus('modified')
  }, [])

  // ── Heading navigation ─────────────────────────────────────
  const handleHeadingClick = useCallback((pos) => {
    editorRef.current?.scrollToPos(pos)
  }, [])

  // ── Auto-save debounce ─────────────────────────────────────
  useEffect(() => {
    if (!autoSave || saveStatus !== 'modified' || !currentFile) return
    const timer = setTimeout(() => handleSave(), 2000)
    return () => clearTimeout(timer)
  }, [fileContent, autoSave, saveStatus, currentFile, handleSave])

  // ── Keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 's') return
      e.preventDefault()
      if (e.shiftKey) handleSaveAs()
      else handleSave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave, handleSaveAs])

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
        if (!handle.name.endsWith('.md')) continue
        const { registerFileHandle } = await import('./api')
        registerFileHandle(handle.name, handle)
        const file = await handle.getFile()
        const content = await file.text()
        await handleFileSelect({ path: handle.name, name: handle.name }, content)
        return
      }
    } else {
      const files = [...(e.dataTransfer.files || [])]
      const mdFile = files.find(f => f.name.endsWith('.md'))
      if (mdFile) {
        await handleFileSelect({ path: mdFile.path, name: mdFile.name })
        const parentDir = mdFile.path.split(/[\\/]/).slice(0, -1).join('\\')
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          MD Viewer
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
            disabled={!currentFile}
            title="미리보기 분할 (View)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
            View
          </button>
          <button className="btn btn-save" onClick={() => handleSave()} disabled={!currentFile || saveStatus === 'saved'}>
            Save
          </button>
          <button className="btn btn-saveas" onClick={handleSaveAs} disabled={!currentFile}>
            Save As…
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="app-body">
        <aside className="sidebar" ref={sidebarRef}>
          {/* File tree pane */}
          <div
            className="sidebar-pane"
            style={{ height: headings.length > 0 ? `${sidebarSplit}%` : '100%' }}
          >
            <FileTree
              ref={fileTreeRef}
              rootDir={rootDir}
              onRootDirChange={setRootDir}
              currentFile={currentFile}
              onFileSelect={handleFileSelect}
              saveStatus={saveStatus}
              recentFiles={recentFiles}
              onRemoveRecent={removeFromRecent}
            />
          </div>

          {/* Drag divider + TOC — only when file has headings */}
          {headings.length > 0 && (
            <>
              <div
                className="sidebar-divider"
                onMouseDown={handleDividerMouseDown}
                title="드래그하여 크기 조절"
              />
              <div className="sidebar-pane" style={{ height: `${100 - sidebarSplit}%` }}>
                <TocPanel headings={headings} onHeadingClick={handleHeadingClick} />
              </div>
            </>
          )}
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
                <p>.md 파일을 여기에 놓으세요</p>
              </div>
            </div>
          )}

          {/* Editor panel */}
          <div
            className="editor-panel"
            style={showPreview && currentFile ? { width: `${previewSplit}%` } : {}}
          >
            {fileLoading ? (
              <div className="loading">
                <div className="spinner" />
                <span>불러오는 중…</span>
              </div>
            ) : currentFile ? (
              <Editor
                ref={editorRef}
                key={currentFile.path}
                initialContent={fileContent}
                onContentChange={handleContentChange}
                onHeadingsChange={setHeadings}
                onSave={handleSave}
              />
            ) : (
              <div className="welcome">
                <div className="welcome-icon">
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14,2 14,8 20,8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </div>
                <h2>MD Viewer</h2>
                <p>왼쪽에서 폴더를 열거나<br/>.md 파일을 여기로 드래그하세요.</p>
                {isWeb && (
                  <button
                    className="btn btn-save"
                    style={{ marginTop: 16 }}
                    onClick={async () => {
                      const result = await pickAndReadFile()
                      if (result) {
                        setCurrentFile({ path: result.path, name: result.name })
                        setFileContent(result.content)
                        setSaveStatus('saved')
                        document.title = `${result.name} — MD Viewer`
                      }
                    }}
                  >
                    파일 열기
                  </button>
                )}
                <div className="welcome-shortcuts">
                  <kbd>Ctrl+S</kbd> 저장 &nbsp;
                  <kbd>Ctrl+Shift+S</kbd> 다른 이름으로 저장
                </div>
              </div>
            )}
          </div>

          {/* Preview split */}
          {showPreview && currentFile && (
            <>
              <div
                className="preview-divider"
                onMouseDown={handlePreviewDividerMouseDown}
                title="드래그하여 크기 조절"
              />
              <div className="preview-panel" style={{ width: `${100 - previewSplit}%` }}>
                <MarkdownPreview content={fileContent} />
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
      />
    </div>
  )
}
