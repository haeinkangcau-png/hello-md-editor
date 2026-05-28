import React, { useState, useCallback, useEffect, useRef } from 'react'

function extractSection(markdown, heading) {
  if (!markdown) return ''
  const lines = markdown.split('\n')

  // Find all heading positions in the raw markdown
  const mdHeadings = []
  lines.forEach((line, idx) => {
    const m = line.match(/^(#{1,6})\s+/)
    if (m) mdHeadings.push({ level: m[1].length, lineIdx: idx })
  })

  // Locate our target heading by level + text match
  let startLineIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)/)
    if (m && m[1].length === heading.level && m[2].trim() === heading.text) {
      startLineIdx = i
      break
    }
  }
  if (startLineIdx === -1) return ''

  // Next heading of equal or higher level marks the end
  const next = mdHeadings.find(h => h.lineIdx > startLineIdx && h.level <= heading.level)
  const endLineIdx = next ? next.lineIdx : lines.length

  return lines.slice(startLineIdx, endLineIdx).join('\n').trimEnd()
}

export default function TocPanel({ headings, onHeadingClick, markdown }) {
  const [collapsed, setCollapsed] = useState(false)
  const [maxDepth, setMaxDepth] = useState(3)
  const [contextMenu, setContextMenu] = useState(null) // { x, y, heading }
  const [copied, setCopied] = useState(false)
  const menuRef = useRef(null)

  if (!headings || headings.length === 0) return null

  const visible = headings.filter(h => h.level <= maxDepth)

  const handleContextMenu = useCallback((e, heading) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, heading })
  }, [])

  const handleCopySection = useCallback(async () => {
    if (!contextMenu) return
    const text = extractSection(markdown, contextMenu.heading)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* silent */ }
    setContextMenu(null)
  }, [contextMenu, markdown])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setContextMenu(null)
    }
    window.addEventListener('mousedown', dismiss)
    return () => window.removeEventListener('mousedown', dismiss)
  }, [contextMenu])

  return (
    <div className="toc-panel">
      <div className="toc-header-row">
        <button
          className="toc-header"
          onClick={() => setCollapsed(v => !v)}
          type="button"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          <span className="toc-title">개요</span>
        </button>

        {/* Depth controller */}
        <div className="toc-depth-ctrl">
          <button
            className="toc-depth-btn"
            onClick={() => setMaxDepth(d => Math.max(1, d - 1))}
            disabled={maxDepth <= 1}
            title="depth 줄이기"
          >−</button>
          <span className="toc-depth-label">H{maxDepth}</span>
          <button
            className="toc-depth-btn"
            onClick={() => setMaxDepth(d => Math.min(6, d + 1))}
            disabled={maxDepth >= 6}
            title="depth 늘리기"
          >+</button>
        </div>
      </div>

      {!collapsed && (
        <div className="toc-body">
          {visible.length === 0 ? (
            <div className="toc-empty">H{maxDepth} 이하 항목 없음</div>
          ) : visible.map((h, i) => (
            <button
              key={i}
              className={`toc-item toc-h${h.level}`}
              style={{ paddingLeft: (h.level - 1) * 10 + 10 }}
              onClick={() => onHeadingClick(h)}
              onContextMenu={(e) => handleContextMenu(e, h)}
              title={h.text}
              type="button"
            >
              {h.text}
            </button>
          ))}
        </div>
      )}

      {/* ── Section copy context menu ── */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="context-menu-item" onClick={handleCopySection}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            섹션 복사 (MD)
          </button>
        </div>
      )}
    </div>
  )
}
