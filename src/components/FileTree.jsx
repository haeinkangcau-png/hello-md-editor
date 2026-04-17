import React, { useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'
import { listFiles, openFolder } from '../api'

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
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      <line x1="4" y1="11" x2="20" y2="11"/>
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
        className={`tree-node ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: indent }}
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

const FileTree = forwardRef(function FileTree(
  { rootDir, onRootDirChange, currentFile, onFileSelect, saveStatus, recentFiles = [], onRemoveRecent },
  ref
) {
  const [activeTab, setActiveTab] = useState('explorer')
  const [inputDir, setInputDir] = useState(rootDir)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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

  const handleOpenFolder = useCallback(async () => {
    const dir = await openFolder()
    if (dir) loadDir(dir)
  }, [loadDir])

  const handleSubmit = (e) => {
    e.preventDefault()
    loadDir(inputDir)
  }

  return (
    <div className="file-tree">
      {/* ── Tabs ── */}
      <div className="tree-tabs">
        <button
          className={`tree-tab ${activeTab === 'explorer' ? 'active' : ''}`}
          onClick={() => setActiveTab('explorer')}
        >
          탐색기
        </button>
        <button
          className={`tree-tab ${activeTab === 'recent' ? 'active' : ''}`}
          onClick={() => setActiveTab('recent')}
        >
          최근 문서
        </button>

        {activeTab === 'explorer' && (
          <button className="open-folder-btn" onClick={handleOpenFolder} title="폴더 열기">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            폴더 열기
          </button>
        )}

        {activeTab === 'recent' && recentFiles.length > 0 && (
          <button
            className="open-folder-btn"
            onClick={() => {
              if (window.confirm('최근 문서 목록을 모두 지우시겠습니까?')) {
                recentFiles.forEach(f => onRemoveRecent(f.path))
              }
            }}
            title="목록 전체 삭제"
          >
            모두 지우기
          </button>
        )}
      </div>

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
    </div>
  )
})

export default FileTree
