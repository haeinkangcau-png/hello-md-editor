import React, { useMemo } from 'react'
import { mdBlock } from '../utils/mdRenderer'

export default function MarkdownPreview({ content }) {
  const html = useMemo(() => mdBlock(content || ''), [content])

  return (
    <div className="preview-pane">
      <div className="preview-header">
        <span className="preview-title">미리보기</span>
      </div>
      <div className="preview-body">
        <div
          className="md-doc"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
