import React, { useEffect, useRef } from 'react'

export default function SearchBar({
  query,
  onQueryChange,
  replaceText,
  onReplaceTextChange,
  showReplace,
  onToggleReplace,
  matchCount,
  currentMatch,
  onNext,
  onPrev,
  onReplace,
  onReplaceAll,
  onClose,
  focusToken,
}) {
  const inputRef = useRef(null)

  // Focus + select on open and whenever focusToken changes (re-pressing Ctrl+F).
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? onPrev() : onNext() }
  }

  const handleReplaceKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    if (e.key === 'Enter') { e.preventDefault(); onReplace() }
  }

  const countLabel = query
    ? (matchCount === 0 ? '결과 없음' : `${currentMatch} / ${matchCount}`)
    : ''

  return (
    <div className="search-bar">
      {/* Search row */}
      <div className="search-row">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder="찾기…"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          spellCheck={false}
        />
        <span className={`search-count ${query && matchCount === 0 ? 'no-match' : ''}`}>
          {countLabel}
        </span>
        <button
          className="search-nav-btn"
          onClick={onPrev}
          disabled={matchCount === 0}
          title="이전 결과 (Shift+Enter)"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <button
          className="search-nav-btn"
          onClick={onNext}
          disabled={matchCount === 0}
          title="다음 결과 (Enter)"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <button
          className={`search-toggle-btn ${showReplace ? 'active' : ''}`}
          onClick={onToggleReplace}
          title="찾아 바꾸기"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        </button>
        <button className="search-close-btn" onClick={onClose} title="닫기 (Esc)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="search-row">
          <input
            className="search-input"
            type="text"
            placeholder="바꿀 텍스트…"
            value={replaceText}
            onChange={e => onReplaceTextChange(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            spellCheck={false}
          />
          <button
            className="search-action-btn"
            onClick={onReplace}
            disabled={matchCount === 0}
            title="현재 항목 바꾸기"
          >
            바꾸기
          </button>
          <button
            className="search-action-btn"
            onClick={onReplaceAll}
            disabled={matchCount === 0}
            title="모두 바꾸기"
          >
            모두 바꾸기
          </button>
        </div>
      )}
    </div>
  )
}
