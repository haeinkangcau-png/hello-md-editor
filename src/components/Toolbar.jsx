import React, { useCallback } from 'react'

function Btn({ active, disabled, onClick, title, children }) {
  return (
    <button
      className={`toolbar-btn ${active ? 'active' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
}

const Sep = () => <div className="toolbar-sep" />

export default function Toolbar({ editor }) {
  if (!editor) return null

  const inTable = editor.isActive('table')

  const cmd = useCallback((fn) => (e) => {
    e.preventDefault()
    fn()
    editor.commands.focus()
  }, [editor])

  return (
    <div className="toolbar">
      {/* ── Undo / Redo ── */}
      <Btn title="실행 취소 (Ctrl+Z)"
        disabled={!editor.can().undo()}
        onClick={cmd(() => editor.chain().undo().run())}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
        </svg>
      </Btn>
      <Btn title="다시 실행 (Ctrl+Y)"
        disabled={!editor.can().redo()}
        onClick={cmd(() => editor.chain().redo().run())}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.5"/>
        </svg>
      </Btn>

      <Sep />

      {/* ── Heading ── */}
      {[1, 2, 3].map(level => (
        <Btn key={level}
          active={editor.isActive('heading', { level })}
          onClick={cmd(() => editor.chain().toggleHeading({ level }).run())}
          title={`제목 ${level}`}>
          H{level}
        </Btn>
      ))}
      <Btn active={editor.isActive('paragraph')}
        onClick={cmd(() => editor.chain().setParagraph().run())}
        title="본문">
        ¶
      </Btn>

      <Sep />

      {/* ── Inline ── */}
      <Btn active={editor.isActive('bold')}
        onClick={cmd(() => editor.chain().toggleBold().run())}
        title="굵게 (Ctrl+B)">
        <strong>B</strong>
      </Btn>
      <Btn active={editor.isActive('italic')}
        onClick={cmd(() => editor.chain().toggleItalic().run())}
        title="기울임 (Ctrl+I)">
        <em>I</em>
      </Btn>
      <Btn active={editor.isActive('strike')}
        onClick={cmd(() => editor.chain().toggleStrike().run())}
        title="취소선">
        <s>S</s>
      </Btn>
      <Btn active={editor.isActive('code')}
        onClick={cmd(() => editor.chain().toggleCode().run())}
        title="인라인 코드">
        {'</>'}
      </Btn>

      <Sep />

      {/* ── Lists ── */}
      <Btn active={editor.isActive('bulletList')}
        onClick={cmd(() => editor.chain().toggleBulletList().run())}
        title="글머리 기호">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/>
          <line x1="9" y1="18" x2="20" y2="18"/>
          <circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/>
          <circle cx="4" cy="18" r="1" fill="currentColor"/>
        </svg>
      </Btn>
      <Btn active={editor.isActive('orderedList')}
        onClick={cmd(() => editor.chain().toggleOrderedList().run())}
        title="번호 매기기">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/>
          <line x1="10" y1="18" x2="21" y2="18"/>
          <path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>
        </svg>
      </Btn>
      <Btn active={editor.isActive('blockquote')}
        onClick={cmd(() => editor.chain().toggleBlockquote().run())}
        title="인용">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
          <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
        </svg>
      </Btn>
      <Btn active={editor.isActive('codeBlock')}
        onClick={cmd(() => editor.chain().toggleCodeBlock().run())}
        title="코드 블록">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
        </svg>
      </Btn>

      <Sep />

      {/* ── Table: Insert ── */}
      <Btn
        onClick={cmd(() => editor.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
        title="표 삽입">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
          <line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
        </svg>
      </Btn>

      {/* ── Table: Operations (only when cursor is in table) ── */}
      {inTable && (
        <>
          <Sep />
          <span className="toolbar-label">표:</span>
          <Btn onClick={cmd(() => editor.chain().addRowBefore().run())} title="위에 행 추가">↑행</Btn>
          <Btn onClick={cmd(() => editor.chain().addRowAfter().run())} title="아래에 행 추가">↓행</Btn>
          <Btn onClick={cmd(() => editor.chain().deleteRow().run())} title="행 삭제">−행</Btn>
          <Sep />
          <Btn onClick={cmd(() => editor.chain().addColumnBefore().run())} title="왼쪽에 열 추가">←열</Btn>
          <Btn onClick={cmd(() => editor.chain().addColumnAfter().run())} title="오른쪽에 열 추가">→열</Btn>
          <Btn onClick={cmd(() => editor.chain().deleteColumn().run())} title="열 삭제">−열</Btn>
          <Sep />
          <Btn onClick={cmd(() => editor.chain().toggleHeaderRow().run())} title="헤더 행 토글">헤더</Btn>
          <Btn onClick={cmd(() => editor.chain().deleteTable().run())} title="표 삭제" className="danger">표삭제</Btn>
        </>
      )}
    </div>
  )
}
