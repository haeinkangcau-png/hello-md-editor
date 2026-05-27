import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react'
import MarkdownPreview from './MarkdownPreview'
import { parseLinkReg } from '../utils/mdRenderer'

// Extract the markdown content of a section (from heading to next same-or-higher heading)
function extractSection(markdown, heading) {
  if (!markdown || !heading) return markdown || ''
  const lines = markdown.split('\n')
  const mdHeadings = []
  lines.forEach((line, idx) => {
    const m = line.match(/^(#{1,6})\s+/)
    if (m) mdHeadings.push({ level: m[1].length, lineIdx: idx })
  })
  let startLineIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)/)
    if (m && m[1].length === heading.level && m[2].trim() === heading.text) {
      startLineIdx = i; break
    }
  }
  if (startLineIdx === -1) return ''
  const next = mdHeadings.find(h => h.lineIdx > startLineIdx && h.level <= heading.level)
  const endLineIdx = next ? next.lineIdx : lines.length
  return lines.slice(startLineIdx, endLineIdx).join('\n').trimEnd()
}

// Extract H1 intro text (text between H1 and the first child heading of the selected section)
function extractH1Intro(markdown, heading) {
  if (!markdown || heading.level <= 1) return ''
  const lines = markdown.split('\n')
  let selLine = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)/)
    if (m && m[1].length === heading.level && m[2].trim() === heading.text) {
      selLine = i; break
    }
  }
  if (selLine === -1) return ''
  let h1Line = -1
  for (let i = selLine - 1; i >= 0; i--) {
    if (/^#\s/.test(lines[i])) { h1Line = i; break }
  }
  if (h1Line === -1) return ''
  const introLines = []
  for (let i = h1Line + 1; i < selLine; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break
    introLines.push(lines[i])
  }
  return introLines.join('\n').trim()
}

export default function ViewMode({ headings, content, currentFilePath }) {
  const previewBodyRef = useRef(null)
  const tocBodyRef = useRef(null)
  const [scrollActiveIdx, setScrollActiveIdx] = useState(0)
  const [selectedHeading, setSelectedHeading] = useState(null)
  const [maxDepth, setMaxDepth] = useState(3)

  const linkReg = useMemo(() => parseLinkReg(content), [content])

  const displayContent = useMemo(() => {
    if (!selectedHeading) return content
    const section = extractSection(content, selectedHeading)
    const intro = extractH1Intro(content, selectedHeading)
    return intro ? `${intro}\n\n---\n\n${section}` : section
  }, [selectedHeading, content])

  const visible = headings.filter(h => h.level <= maxDepth)
  const selectedIdx = selectedHeading ? headings.indexOf(selectedHeading) : null
  const activeIdx = selectedIdx !== null ? selectedIdx : scrollActiveIdx

  const handleTocClick = useCallback((heading, origIdx) => {
    setSelectedHeading(prev => {
      const prevIdx = prev ? headings.indexOf(prev) : -1
      return prevIdx === origIdx ? null : heading
    })
    requestAnimationFrame(() => {
      if (previewBodyRef.current) previewBodyRef.current.scrollTop = 0
    })
  }, [headings])

  const handleClearSection = useCallback(() => setSelectedHeading(null), [])

  useEffect(() => {
    const container = previewBodyRef.current
    if (!container || headings.length === 0 || selectedHeading) return
    const observer = new IntersectionObserver(
      (entries) => {
        let best = null
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const idx = parseInt(entry.target.dataset.hidx, 10)
            if (!isNaN(idx) && (best === null || idx < best)) best = idx
          }
        })
        if (best !== null) setScrollActiveIdx(best)
      },
      { root: container, rootMargin: '-5% 0px -75% 0px', threshold: 0 }
    )
    container.querySelectorAll('[data-hidx]').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [headings, content, selectedHeading])

  useEffect(() => {
    tocBodyRef.current?.querySelector('.view-toc-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  return (
    <div className="view-mode">
      <nav className="view-toc">
        <div className="view-toc-header">
          <span className="view-toc-title">목차</span>
          <div className="toc-depth-ctrl">
            <button className="toc-depth-btn" onClick={() => setMaxDepth(d => Math.max(1, d - 1))} disabled={maxDepth <= 1} title="depth 줄이기">−</button>
            <span className="toc-depth-label">H{maxDepth}</span>
            <button className="toc-depth-btn" onClick={() => setMaxDepth(d => Math.min(6, d + 1))} disabled={maxDepth >= 6} title="depth 늘리기">+</button>
          </div>
        </div>

        {selectedHeading && (
          <button className="view-toc-all-btn" onClick={handleClearSection} type="button">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            전체 보기
          </button>
        )}

        <div className="view-toc-body" ref={tocBodyRef}>
          {visible.length === 0 ? (
            <div className="toc-empty">H{maxDepth} 이하 항목 없음</div>
          ) : visible.map((h, i) => {
            const origIdx = headings.indexOf(h)
            const isActive = origIdx === activeIdx
            const isSelected = selectedIdx !== null && origIdx === selectedIdx
            return (
              <button
                key={i}
                className={`view-toc-item view-toc-h${h.level}${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
                style={{ paddingLeft: (h.level - 1) * 12 + 14 }}
                onClick={() => handleTocClick(h, origIdx)}
                title={isSelected ? '클릭하면 전체 보기' : h.text}
                type="button"
              >
                <span className="view-toc-indicator" />
                {h.text}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="view-preview-wrap">
        <MarkdownPreview
          content={displayContent}
          scrollRef={previewBodyRef}
          linkReg={linkReg}
          sectionTitle={selectedHeading ? selectedHeading.text : null}
          onClearSection={selectedHeading ? handleClearSection : null}
          currentFilePath={currentFilePath}
        />
      </div>
    </div>
  )
}
