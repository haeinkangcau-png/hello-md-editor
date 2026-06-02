import React, { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { listFiles, openFolder, revealInExplorer, createFolder, writeFile, renameFile } from '../api'

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14,2 14,8 20,8"/>
    </svg>
  )
}

function FolderIcon({ open }) {
  return open ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000) return '방금 전'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return `${Math.floor(diff / 86_400_000)}일 전`
}

function TreeNode({ item, depth, currentFile, onFileSelect, saveStatus }) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(false)

  const isActive = !item.isDirectory && currentFile?.path === item.path
  const indent = depth * 14 + 8

  const handleClick = useCallback(async () => {
    if (item.isDirectory) {
      if (!expanded) {
        setLoading(true)
        try { const { items } = await listFiles(item.path); setChildren(items) }
        catch { setChildren([]) }
        finally { setLoading(false) }
      }
      setExpanded(v => !v)
    } else {
      onFileSelect(item)
    }
  }, [item, expanded, onFileSelect])

  return (
    <div>
      <div
        className={`tree-node ${item.isDirectory ? 'is-dir' : ''} ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: item.isDirectory ? Math.max(indent - 2, 4) : indent }}
        onClick={handleClick}
        title={item.path}
      >
        {item.isDirectory && (
          <svg
            width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s', flexShrink: 0 }}
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
        <span className="tree-icon">
          {item.isDirectory ? <FolderIcon open={expanded} /> : <FileIcon />}
        </span>
        <span className="tree-name">{item.name}</span>
        {isActive && saveStatus === 'modified' && <span className="tree-dot" title="수정됨" />}
        {loading && <span className="tree-loading">…</span>}
      </div>

      {item.isDirectory && expanded && (
        <div>
          {!loading && children.length === 0 && (
            <div className="tree-empty" style={{ paddingLeft: indent + 22 }}>비어 있음</div>
          )}
          {children.map(child => (
            <TreeNode key={child.path} item={child} depth={depth + 1}
              currentFile={currentFile} onFileSelect={onFileSelect} saveStatus={saveStatus} />
          ))}
        </div>
      )}
    </div>
  )
}

function NotebookIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  )
}

function NotebookTreeNode({ item, depth, currentFile, onFileSelect, saveStatus, onContextMenu,
  inlineInput, inlineValue, setInlineValue, inlineInputRef, onInlineKeyDown, onInlineBlur, parentRefresh, onFolderSelect }) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(false)

  const isActive = !item.isDirectory && currentFile?.path === item.path
  const indent = depth * 14 + 8
  const isRenaming = inlineInput?.type === 'rename-file' && inlineInput?.filePath === item.path

  const handleClick = useCallback(async () => {
    if (isRenaming) return
    if (item.isDirectory) {
      if (!expanded) {
        setLoading(true)
        try { const { items } = await listFiles(item.path); setChildren(items) }
        catch { setChildren([]) }
        finally { setLoading(false) }
      }
      setExpanded(v => !v)
      onFolderSelect?.(item.path)
    } else {
      onFileSelect(item)
    }
  }, [item, expanded, onFileSelect, isRenaming, onFolderSelect])

  const refreshChildren = useCallback(async () => {
    if (item.isDirectory) {
      try { const { items } = await listFiles(item.path); setChildren(items) }
      catch { setChildren([]) }
    }
  }, [item])

  // Auto-expand subfolder when inline input targets it
  useEffect(() => {
    if (item.isDirectory && inlineInput &&
        (inlineInput.type === 'folder' || inlineInput.type === 'file') &&
        inlineInput.parentPath === item.path) {
      setExpanded(true)
    }
  }, [item, inlineInput])

  // 파일 노드는 부모의 refresh를, 폴더 노드는 자신의 refresh를 전달
  const handleContextMenuLocal = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, item, item.isDirectory ? refreshChildren : parentRefresh)
  }, [item, onContextMenu, refreshChildren, parentRefresh])

  return (
    <div>
      <div
        className={`tree-node ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: indent }}
        onClick={handleClick}
        onContextMenu={handleContextMenuLocal}
        title={item.path}
      >
        {item.isDirectory && (
          <svg
            width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s', flexShrink: 0 }}
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
        <span className="tree-icon">
          {item.isDirectory ? <FolderIcon open={expanded} /> : <FileIcon />}
        </span>
        {isRenaming ? (
          <input
            ref={inlineInputRef}
            className="inline-input"
            value={inlineValue}
            onChange={e => setInlineValue(e.target.value)}
            onKeyDown={onInlineKeyDown}
            onBlur={onInlineBlur}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="tree-name">{item.name}</span>
        )}
        {!isRenaming && isActive && saveStatus === 'modified' && <span className="tree-dot" title="수정됨" />}
        {loading && <span className="tree-loading">…</span>}
      </div>

      {item.isDirectory && expanded && (
        <div>
          {!loading && children.length === 0 && !inlineInput && (
            <div className="tree-empty" style={{ paddingLeft: indent + 22 }}>비어 있음</div>
          )}
          {children.map(child => (
            <NotebookTreeNode key={child.path} item={child} depth={depth + 1}
              currentFile={currentFile} onFileSelect={onFileSelect} saveStatus={saveStatus}
              onContextMenu={onContextMenu}
              inlineInput={inlineInput} inlineValue={inlineValue} setInlineValue={setInlineValue}
              inlineInputRef={inlineInputRef} onInlineKeyDown={onInlineKeyDown} onInlineBlur={onInlineBlur}
              parentRefresh={refreshChildren} />
          ))}
          {/* 인라인 새 폴더/파일 입력 (서브폴더) */}
          {inlineInput && (inlineInput.type === 'folder' || inlineInput.type === 'file') &&
            inlineInput.parentPath === item.path && (
            <div className="inline-input-row" style={{ paddingLeft: indent + 22 }}>
              <span className="tree-icon">
                {inlineInput.type === 'folder' ? <FolderIcon open={false} /> : <FileIcon />}
              </span>
              <input
                ref={inlineInputRef}
                className="inline-input"
                value={inlineValue}
                onChange={e => setInlineValue(e.target.value)}
                onKeyDown={(e) => {
                  onInlineKeyDown(e)
                  if (e.key === 'Enter') setTimeout(refreshChildren, 200)
                }}
                onBlur={() => { onInlineBlur(); setTimeout(refreshChildren, 200) }}
                placeholder={inlineInput.type === 'folder' ? '폴더명…' : '파일명.md…'}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const NotebookFolder = forwardRef(function NotebookFolder({ project, projectIndex, currentFile, onFileSelect, saveStatus,
  onContextMenu, onRootContextMenu, inlineInput, inlineValue, setInlineValue,
  inlineInputRef, onInlineKeyDown, onInlineBlur, onFolderSelect }, ref) {
  const [expanded, setExpanded] = useState(true)
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const loadChildren = useCallback(async () => {
    setLoading(true)
    try { const { items } = await listFiles(project.path); setChildren(items) }
    catch { setChildren([]) }
    finally { setLoading(false); setLoaded(true) }
  }, [project.path])

  useEffect(() => {
    if (!loaded) loadChildren()
  }, [loaded, loadChildren])

  const refreshChildren = useCallback(async () => {
    try { const { items } = await listFiles(project.path); setChildren(items) }
    catch { setChildren([]) }
  }, [project.path])

  useImperativeHandle(ref, () => ({ refresh: refreshChildren }), [refreshChildren])

  // Auto-expand when inline input targets this folder
  useEffect(() => {
    if (inlineInput && (inlineInput.type === 'folder' || inlineInput.type === 'file') &&
        inlineInput.parentPath === project.path) {
      setExpanded(true)
    }
  }, [inlineInput, project.path])

  const handleRootCtx = useCallback((e) => {
    e.preventDefault()
    onRootContextMenu(e, projectIndex)
  }, [onRootContextMenu, projectIndex])

  const isRenaming = inlineInput?.type === 'rename-notebook' && inlineInput?.projectIndex === projectIndex

  return (
    <div className="notebook-folder">
      <div
        className="notebook-folder-header"
        onClick={() => { setExpanded(v => !v); onFolderSelect?.(project.path) }}
        onContextMenu={handleRootCtx}
        title={project.path}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s', flexShrink: 0 }}
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span className="tree-icon"><NotebookIcon /></span>
        {isRenaming ? (
          <input
            ref={inlineInputRef}
            className="inline-input"
            value={inlineValue}
            onChange={e => setInlineValue(e.target.value)}
            onKeyDown={onInlineKeyDown}
            onBlur={onInlineBlur}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="notebook-folder-name">{project.name}</span>
        )}
        <span className="notebook-folder-path">{project.path}</span>
        {loading && <span className="tree-loading">…</span>}
      </div>

      {expanded && (
        <div className="notebook-folder-body">
          {!loading && children.length === 0 && (
            <div className="tree-empty" style={{ paddingLeft: 30 }}>비어 있음</div>
          )}
          {children.map(child => (
            <NotebookTreeNode key={child.path} item={child} depth={1}
              currentFile={currentFile} onFileSelect={onFileSelect} saveStatus={saveStatus}
              onContextMenu={onContextMenu}
              inlineInput={inlineInput} inlineValue={inlineValue} setInlineValue={setInlineValue}
              inlineInputRef={inlineInputRef} onInlineKeyDown={onInlineKeyDown} onInlineBlur={onInlineBlur}
              parentRefresh={refreshChildren} onFolderSelect={onFolderSelect} />
          ))}
          {/* 인라인 새 폴더/파일 입력 */}
          {inlineInput && (inlineInput.type === 'folder' || inlineInput.type === 'file') &&
            inlineInput.parentPath === project.path && (
            <div className="inline-input-row" style={{ paddingLeft: 22 }}>
              <span className="tree-icon">
                {inlineInput.type === 'folder' ? <FolderIcon open={false} /> : <FileIcon />}
              </span>
              <input
                ref={inlineInputRef}
                className="inline-input"
                value={inlineValue}
                onChange={e => setInlineValue(e.target.value)}
                onKeyDown={(e) => {
                  onInlineKeyDown(e)
                  if (e.key === 'Enter') setTimeout(refreshChildren, 200)
                }}
                onBlur={() => { onInlineBlur(); setTimeout(refreshChildren, 200) }}
                placeholder={inlineInput.type === 'folder' ? '폴더명…' : '파일명.md…'}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
})

const FileTree = forwardRef(function FileTree(
  { rootDir, onRootDirChange, currentFile, onFileSelect, onFileRenamed, saveStatus, recentFiles = [], onRemoveRecent,
    projects = [], onProjectsChange, onFolderSelect },
  ref
) {
  const [activeTab, setActiveTab] = useState(() => projects.length > 0 ? 'notebook' : 'recent')
  const [inputDir, setInputDir] = useState(rootDir)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState(null) // { x, y, file, refresh? }
  const contextMenuRef = useRef(null)
  const [inlineInput, setInlineInput] = useState(null) // { type: 'folder'|'file'|'rename-notebook'|'rename-file', parentPath?, projectIndex?, refresh? }
  const [inlineValue, setInlineValue] = useState('')
  const inlineInputRef = useRef(null)
  const notebookRefs = useRef({})

  const loadDir = useCallback(async (dir) => {
    if (!dir) return
    setLoading(true)
    setError('')
    try {
      const { items: data, dir: resolved } = await listFiles(dir)
      setItems(data)
      onRootDirChange(resolved)
      setInputDir(resolved)
    } catch (err) {
      setError(err.message)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [onRootDirChange])

  useImperativeHandle(ref, () => ({ loadDir }), [loadDir])

  const handleContextMenu = useCallback((e, file) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null)
      }
    }
    window.addEventListener('mousedown', dismiss)
    return () => window.removeEventListener('mousedown', dismiss)
  }, [contextMenu])

  const handleOpenFolder = useCallback(async () => {
    const dir = await openFolder()
    if (dir) loadDir(dir)
  }, [loadDir])

  const handleSubmit = (e) => {
    e.preventDefault()
    loadDir(inputDir)
  }

  // ── Notebook handlers ──────────────────────────────────────
  const handleAddNotebook = useCallback(async () => {
    const dir = await openFolder()
    if (!dir) return
    if (projects.some(p => p.path === dir)) return
    const name = dir.replace(/\\/g, '/').split('/').pop()
    onProjectsChange([...projects, { path: dir, name }])
  }, [projects, onProjectsChange])

  const handleRemoveNotebook = useCallback((index) => {
    const updated = projects.filter((_, i) => i !== index)
    onProjectsChange(updated)
  }, [projects, onProjectsChange])

  const handleRenameNotebook = useCallback((index, newName) => {
    if (!newName.trim()) return
    const updated = projects.map((p, i) => i === index ? { ...p, name: newName.trim() } : p)
    onProjectsChange(updated)
  }, [projects, onProjectsChange])

  const handleNotebookContextMenu = useCallback((e, item, refreshFn) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, file: item, type: 'notebook-item', refresh: refreshFn })
  }, [])

  const handleNotebookRootContextMenu = useCallback((e, projIndex) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'notebook-root', projectIndex: projIndex })
  }, [])

  const handleRefreshNotebooks = useCallback(() => {
    Object.values(notebookRefs.current).forEach(ref => ref?.refresh())
  }, [])

  const handleRefreshExplorer = useCallback(() => {
    if (rootDir) loadDir(rootDir)
  }, [rootDir, loadDir])

  const startInlineInput = useCallback((type, parentPath, refresh) => {
    setInlineInput({ type, parentPath, refresh })
    setInlineValue('')
    setContextMenu(null)
    setTimeout(() => inlineInputRef.current?.focus(), 50)
  }, [])

  const handleInlineSubmit = useCallback(async () => {
    if (!inlineValue.trim() || !inlineInput) return
    const { type, parentPath, refresh } = inlineInput
    const sep = parentPath?.includes('/') ? '/' : '\\'
    try {
      if (type === 'folder') {
        const newPath = parentPath + sep + inlineValue.trim()
        await createFolder(newPath)
      } else if (type === 'file') {
        let fileName = inlineValue.trim()
        if (!fileName.endsWith('.md')) fileName += '.md'
        const newPath = parentPath + sep + fileName
        await writeFile(newPath, '')
      } else if (type === 'rename-notebook') {
        handleRenameNotebook(inlineInput.projectIndex, inlineValue.trim())
      } else if (type === 'rename-file') {
        const oldPath = inlineInput.filePath
        const dir = oldPath.replace(/[/\\][^/\\]+$/, '')
        let newName = inlineValue.trim()
        if (!newName.endsWith('.md') && !newName.endsWith('.html')) newName += '.md'
        const newPath = dir + sep + newName
        await renameFile(oldPath, newPath)
        if (onFileRenamed) onFileRenamed(oldPath, newPath, newName)
      }
      if (refresh) await refresh()
    } catch (err) {
      alert(`실패: ${err.message}`)
    }
    setInlineInput(null)
    setInlineValue('')
  }, [inlineValue, inlineInput, handleRenameNotebook])

  const handleInlineKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleInlineSubmit()
    } else if (e.key === 'Escape') {
      setInlineInput(null)
      setInlineValue('')
    }
  }, [handleInlineSubmit])

  return (
    <div className="file-tree">
      {/* ── Tabs ── */}
      <div className="tree-tabs">
        <button
          className={`tree-tab ${activeTab === 'notebook' ? 'active' : ''}`}
          onClick={() => setActiveTab('notebook')}
        >
          노트북
        </button>
        <button
          className={`tree-tab ${activeTab === 'recent' ? 'active' : ''}`}
          onClick={() => setActiveTab('recent')}
        >
          최근 문서
        </button>
        <button
          className={`tree-tab ${activeTab === 'explorer' ? 'active' : ''}`}
          onClick={() => setActiveTab('explorer')}
        >
          탐색기
        </button>
      </div>

      {/* ── Tab action bar ── */}
      {activeTab === 'notebook' && (
        <div className="tree-action-bar">
          <button className="action-bar-btn" onClick={handleAddNotebook} title="노트북 폴더 추가">
            <PlusIcon />
            <span>노트북 추가</span>
          </button>
          <button className="action-bar-btn" onClick={handleRefreshNotebooks} title="새로고침">
            <RefreshIcon />
          </button>
        </div>
      )}
      {activeTab === 'explorer' && (
        <div className="tree-action-bar">
          <button className="action-bar-btn" onClick={handleOpenFolder} title="폴더 열기">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span>폴더 열기</span>
          </button>
          <button className="action-bar-btn" onClick={handleRefreshExplorer} title="새로고침" disabled={!rootDir}>
            <RefreshIcon />
          </button>
        </div>
      )}
      {activeTab === 'recent' && recentFiles.length > 0 && (
        <div className="tree-action-bar">
          <button
            className="action-bar-btn"
            onClick={() => {
              if (window.confirm('최근 문서 목록을 모두 지우시겠습니까?')) {
                recentFiles.forEach(f => onRemoveRecent(f.path))
              }
            }}
            title="목록 전체 삭제"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <span>모두 지우기</span>
          </button>
        </div>
      )}

      {/* ── Notebook tab ── */}
      {activeTab === 'notebook' && (
        <div className="notebook-list">
          {projects.length === 0 ? (
            <div className="tree-hint">
              노트북 폴더를 추가하세요.<br />
              폴더를 지정하면 하위 파일을<br />트리로 탐색할 수 있습니다.
            </div>
          ) : projects.map((proj, pi) => (
            <NotebookFolder
              key={proj.path}
              ref={el => { notebookRefs.current[pi] = el }}
              project={proj}
              projectIndex={pi}
              currentFile={currentFile}
              onFileSelect={onFileSelect}
              saveStatus={saveStatus}
              onContextMenu={handleNotebookContextMenu}
              onRootContextMenu={handleNotebookRootContextMenu}
              inlineInput={inlineInput}
              inlineValue={inlineValue}
              setInlineValue={setInlineValue}
              inlineInputRef={inlineInputRef}
              onInlineKeyDown={handleInlineKeyDown}
              onInlineBlur={handleInlineSubmit}
              onFolderSelect={onFolderSelect}
            />
          ))}
        </div>
      )}

      {/* ── Explorer tab ── */}
      {activeTab === 'explorer' && (
        <>
          <form className="dir-form" onSubmit={handleSubmit}>
            <input
              className="dir-input"
              value={inputDir}
              onChange={e => setInputDir(e.target.value)}
              placeholder="경로 직접 입력 후 Enter…"
              spellCheck={false}
            />
            <button type="submit" className="dir-btn" title="이동">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </form>

          {error && <div className="tree-error">{error}</div>}

          <div className="tree-body">
            {loading && <div className="tree-loading-msg">로딩 중…</div>}
            {!loading && items.length === 0 && rootDir && !error && (
              <div className="tree-empty-msg">.md 파일이 없습니다</div>
            )}
            {!loading && !rootDir && !error && (
              <div className="tree-hint">위 버튼으로 폴더를 열거나<br />경로를 직접 입력하세요</div>
            )}
            {items.map(item => (
              <TreeNode key={item.path} item={item} depth={0}
                currentFile={currentFile} onFileSelect={onFileSelect} saveStatus={saveStatus} />
            ))}
          </div>
        </>
      )}

      {/* ── Recent tab ── */}
      {activeTab === 'recent' && (
        <div className="recent-list">
          {recentFiles.length === 0 ? (
            <div className="tree-hint">최근 작업한 파일이 없습니다</div>
          ) : recentFiles.map(file => {
            const dir = file.path.replace(/[^/\\]+$/, '').replace(/[/\\]$/, '')
            const isActive = currentFile?.path === file.path
            return (
              <div
                key={file.path}
                className={`recent-item ${isActive ? 'active' : ''}`}
                onClick={() => onFileSelect(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                title={file.path}
              >
                <span className="recent-item-icon"><FileIcon /></span>
                <div className="recent-item-info">
                  <span className="recent-item-name">{file.name}</span>
                  <span className="recent-item-dir">{dir}</span>
                </div>
                <span className="recent-item-time">{timeAgo(file.openedAt)}</span>
                <button
                  className="recent-item-remove"
                  onClick={e => { e.stopPropagation(); onRemoveRecent(file.path) }}
                  title="목록에서 제거"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Context menu ── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {/* 노트북 루트 컨텍스트 메뉴 */}
          {contextMenu.type === 'notebook-root' && (
            <>
              <button
                className="context-menu-item"
                onClick={() => {
                  const pi = contextMenu.projectIndex
                  startInlineInput('folder', projects[pi].path, () => notebookRefs.current[pi]?.refresh())
                }}
              >
                새 폴더
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  const pi = contextMenu.projectIndex
                  startInlineInput('file', projects[pi].path, () => notebookRefs.current[pi]?.refresh())
                }}
              >
                새 파일 (.md)
              </button>
              <button
                className="context-menu-item"
                onClick={() => { revealInExplorer(projects[contextMenu.projectIndex].path); setContextMenu(null) }}
              >
                탐색기에서 열기
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  setInlineInput({ type: 'rename-notebook', projectIndex: contextMenu.projectIndex })
                  setInlineValue(projects[contextMenu.projectIndex].name)
                  setContextMenu(null)
                  setTimeout(() => inlineInputRef.current?.focus(), 50)
                }}
              >
                이름 변경
              </button>
              <button
                className="context-menu-item context-menu-danger"
                onClick={() => {
                  if (window.confirm(`"${projects[contextMenu.projectIndex].name}" 노트북을 목록에서 제거하시겠습니까?\n(실제 폴더는 삭제되지 않습니다)`)) {
                    handleRemoveNotebook(contextMenu.projectIndex)
                  }
                  setContextMenu(null)
                }}
              >
                노트북 제거
              </button>
            </>
          )}

          {/* 노트북 내 폴더 컨텍스트 메뉴 */}
          {contextMenu.type === 'notebook-item' && contextMenu.file?.isDirectory && (
            <>
              <button
                className="context-menu-item"
                onClick={() => { startInlineInput('folder', contextMenu.file.path, contextMenu.refresh); }}
              >
                새 폴더
              </button>
              <button
                className="context-menu-item"
                onClick={() => { startInlineInput('file', contextMenu.file.path, contextMenu.refresh); }}
              >
                새 파일 (.md)
              </button>
              <button
                className="context-menu-item"
                onClick={() => { revealInExplorer(contextMenu.file.path); setContextMenu(null) }}
              >
                탐색기에서 열기
              </button>
            </>
          )}

          {/* 노트북 내 파일 컨텍스트 메뉴 */}
          {contextMenu.type === 'notebook-item' && !contextMenu.file?.isDirectory && (
            <>
              <button
                className="context-menu-item"
                onClick={() => {
                  setInlineInput({ type: 'rename-file', filePath: contextMenu.file.path, refresh: contextMenu.refresh })
                  setInlineValue(contextMenu.file.name)
                  setContextMenu(null)
                  setTimeout(() => inlineInputRef.current?.focus(), 50)
                }}
              >
                이름 변경
              </button>
              <button
                className="context-menu-item"
                onClick={() => { revealInExplorer(contextMenu.file.path); setContextMenu(null) }}
              >
                탐색기에서 열기
              </button>
            </>
          )}

          {/* 기본 (최근 문서) 컨텍스트 메뉴 */}
          {!contextMenu.type && (
            <button
              className="context-menu-item"
              onClick={() => { revealInExplorer(contextMenu.file.path); setContextMenu(null) }}
            >
              탐색기에서 열기
            </button>
          )}
        </div>
      )}
    </div>
  )
})

export default FileTree
