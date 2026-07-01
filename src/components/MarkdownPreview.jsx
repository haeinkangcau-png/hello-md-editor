import React, { useMemo, useEffect, useRef, useCallback, useState } from 'react'
import { mdBlock } from '../utils/mdRenderer'
import { isWeb, readImageAsBlob, openPath } from '../api'
import { isLocalPath } from '../utils/pathLink'
import LinkActionPopup from './LinkActionPopup'
import ImageLightbox from './ImageLightbox'

export default function MarkdownPreview({ content, scrollRef, linkReg, sectionTitle, onClearSection, currentFilePath }) {
  const html = useMemo(() => mdBlock(content || '', linkReg), [content, linkReg])
  const bodyRef = useRef(null)
  const [linkPopup, setLinkPopup] = useState(null) // { x, y, kind, value }
  const [lightbox, setLightbox] = useState(null) // { src, alt }

  const handleDoubleClick = useCallback((e) => {
    const img = e.target.closest?.('img')
    if (img) { e.preventDefault(); setLightbox({ src: img.currentSrc || img.src, alt: img.alt }) }
  }, [])

  // 링크 클릭 시: 외부로 바로 이동하지 않고 액션 팝업(열기/복사)을 띄운다.
  const handleClick = useCallback((e) => {
    const a = e.target.closest?.('a')
    if (!a) return
    const raw = a.getAttribute('href') || a.href || ''
    if (!raw) return
    e.preventDefault()
    setLinkPopup({ x: e.clientX, y: e.clientY, kind: isLocalPath(raw) ? 'path' : 'url', value: raw })
  }, [])

  // Web mode: replace ./relative image paths with blob URLs after render
  useEffect(() => {
    if (!isWeb || !currentFilePath) return
    const el = bodyRef.current
    if (!el) return
    const dir = currentFilePath.replace(/[/\\][^/\\]+$/, '')
    el.querySelectorAll('img').forEach(async (img) => {
      const src = img.getAttribute('src')
      if (!src?.startsWith('./')) return
      const absPath = `${dir}/${src.slice(2)}`
      const blobUrl = await readImageAsBlob(absPath)
      if (blobUrl) img.src = blobUrl
    })
  }, [html, currentFilePath])

  const setBodyRef = useCallback((el) => {
    bodyRef.current = el
    if (scrollRef && typeof scrollRef === 'object') scrollRef.current = el
  }, [scrollRef])

  return (
    <div className="preview-pane">
      <div className="preview-header">
        {sectionTitle ? (
          <div className="preview-section-header">
            <button className="preview-section-back" onClick={onClearSection} type="button" title="전체 보기로 돌아가기">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span className="preview-title">{sectionTitle}</span>
          </div>
        ) : (
          <span className="preview-title">미리보기</span>
        )}
      </div>
      <div className="preview-body" ref={setBodyRef}>
        <div
          className="md-doc"
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      {linkPopup && (
        <LinkActionPopup
          x={linkPopup.x}
          y={linkPopup.y}
          kind={linkPopup.kind}
          value={linkPopup.value}
          onOpen={async () => {
            const lp = linkPopup
            setLinkPopup(null)
            if (lp.kind === 'path') {
              const r = await openPath(lp.value)
              if (r && r.success === false) alert(r.error || '경로를 열 수 없습니다.')
            } else {
              window.open(lp.value, '_blank', 'noopener,noreferrer')
            }
          }}
          onCopy={async () => {
            try { await navigator.clipboard.writeText(linkPopup.value) } catch { /* ignore */ }
            setLinkPopup(null)
          }}
          onClose={() => setLinkPopup(null)}
        />
      )}
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}
