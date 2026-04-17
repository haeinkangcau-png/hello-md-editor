import React, { useState } from 'react'

export default function TocPanel({ headings, onHeadingClick }) {
  const [collapsed, setCollapsed] = useState(false)
  const [maxDepth, setMaxDepth] = useState(3)

  if (!headings || headings.length === 0) return null

  const visible = headings.filter(h => h.level <= maxDepth)

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
              onClick={() => onHeadingClick(h.pos)}
              title={h.text}
              type="button"
            >
              {h.text}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
