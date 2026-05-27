import React, { useMemo, useEffect, useRef, useCallback } from 'react'
import { mdBlock } from '../utils/mdRenderer'
import { isWeb, readImageAsBlob } from '../api'

export default function MarkdownPreview({ content, scrollRef, linkReg, sectionTitle, onClearSection, currentFilePath }) {
  const html = useMemo(() => mdBlock(content || '', linkReg), [content, linkReg])
  const bodyRef = useRef(null)

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
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
