import React from 'react'

// ── Block type detection ───────────────────────────────────
function getBlockInfo(editor) {
  if (editor.isActive('heading', { level: 1 })) return { label: 'H1', desc: '제목 1', color: '#7c3aed' }
  if (editor.isActive('heading', { level: 2 })) return { label: 'H2', desc: '제목 2', color: '#6d28d9' }
  if (editor.isActive('heading', { level: 3 })) return { label: 'H3', desc: '제목 3', color: '#5b21b6' }
  if (editor.isActive('heading', { level: 4 })) return { label: 'H4', desc: '제목 4', color: '#4c1d95' }
  if (editor.isActive('heading', { level: 5 })) return { label: 'H5', desc: '제목 5', color: '#4c1d95' }
  if (editor.isActive('heading', { level: 6 })) return { label: 'H6', desc: '제목 6', color: '#4c1d95' }
  if (editor.isActive('codeBlock'))   return { label: 'Code', desc: '코드 블록',  color: '#0369a1' }
  if (editor.isActive('blockquote'))  return { label: '❝',    desc: '인용',       color: '#0f766e' }
  if (editor.isActive('bulletList'))  return { label: '• 목록', desc: '글머리 기호', color: '#b45309' }
  if (editor.isActive('orderedList')) return { label: '1. 목록', desc: '번호 매기기', color: '#b45309' }
  if (editor.isActive('paragraph'))   return { label: '¶',    desc: '본문',       color: '#374151' }
  return null
}

function getMarks(editor) {
  const marks = []
  if (editor.isActive('bold'))   marks.push({ key: 'B',  title: '굵게' })
  if (editor.isActive('italic')) marks.push({ key: 'I',  title: '기울임' })
  if (editor.isActive('strike')) marks.push({ key: 'S',  title: '취소선' })
  if (editor.isActive('code'))   marks.push({ key: '<>', title: '인라인 코드' })
  return marks
}

function getTableInfo(editor) {
  if (!editor.isActive('table')) return null
  const isHeader = editor.isActive('tableHeader')
  return { isHeader, label: isHeader ? '헤더 셀' : '데이터 셀' }
}

// ── Component ──────────────────────────────────────────────
export default function SelectionInfo({ editor }) {
  if (!editor) return null

  const block = getBlockInfo(editor)
  const marks = getMarks(editor)
  const table = getTableInfo(editor)

  const hasInfo = block || marks.length > 0 || table

  return (
    <div className="sel-bar">
      {/* Block type badge */}
      {block && (
        <div className="sel-block" style={{ '--block-color': block.color }} title={block.desc}>
          <span className="sel-block-label">{block.label}</span>
          <span className="sel-block-desc">{block.desc}</span>
        </div>
      )}

      {/* Table context */}
      {table && (
        <>
          <span className="sel-sep">›</span>
          <div className={`sel-tag sel-tag--table ${table.isHeader ? 'sel-tag--header' : ''}`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
            {table.label}
          </div>
        </>
      )}

      {/* Divider between block info and marks */}
      {block && marks.length > 0 && <span className="sel-divider" />}

      {/* Active marks */}
      {marks.map(m => (
        <div key={m.key} className="sel-mark" title={m.title}>
          {m.key}
        </div>
      ))}

      {/* Empty state */}
      {!hasInfo && (
        <span className="sel-empty">선택 없음</span>
      )}
    </div>
  )
}
