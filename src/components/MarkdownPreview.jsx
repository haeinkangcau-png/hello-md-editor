import React, { useMemo } from 'react'
import { mdBlock } from '../utils/mdRenderer'

export default function MarkdownPreview({ content, scrollRef, linkReg, sectionTitle, onClearSection }) {
  const html = useMemo(() => mdBlock(content || '', linkReg), [content, linkReg])

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
      <div className="preview-body" ref={scrollRef}>
        <div
          className="md-doc"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
