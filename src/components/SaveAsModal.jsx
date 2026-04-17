import React, { useState, useEffect, useRef } from 'react'

export default function SaveAsModal({ currentPath, onSave, onClose }) {
  const [newPath, setNewPath] = useState(currentPath || '')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = newPath.trim()
    if (!trimmed) return
    // Ensure .md extension
    const finalPath = trimmed.endsWith('.md') ? trimmed : trimmed + '.md'
    onSave(finalPath)
  }

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal">
        <div className="modal-header">
          <h3>다른 이름으로 저장</h3>
          <button className="modal-close" onClick={onClose} type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <label className="modal-label">저장 경로</label>
            <input
              ref={inputRef}
              className="modal-input"
              value={newPath}
              onChange={e => setNewPath(e.target.value)}
              placeholder="C:\path\to\file.md"
              spellCheck={false}
            />
            <p className="modal-hint">.md 확장자가 없으면 자동으로 추가됩니다.</p>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>취소</button>
            <button type="submit" className="btn btn-save" disabled={!newPath.trim()}>저장</button>
          </div>
        </form>
      </div>
    </div>
  )
}
