import React, { useState } from 'react'

export default function TocPanel({ headings, onHeadingClick }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!headings || headings.length === 0) return null

  return (
    <div className="toc-panel">
      <button
        className="toc-header"
        onClick={() => setCollapsed(v => !v)}
        type="button"
      >
        <span className="toc-title">개요</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {!collapsed && (
        <div className="toc-body">
          {headings.map((h, i) => (
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
