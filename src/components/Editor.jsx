import React, {
  useEffect, useRef, useCallback, useState,
  forwardRef, useImperativeHandle,
} from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import Toolbar from './Toolbar'
import SelectionInfo from './SelectionInfo'
import { normalizeHtmlTables } from '../utils/mdRenderer'

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function extractHeadings(editor) {
  const headings = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({ level: node.attrs.level, text: node.textContent, pos })
    }
  })
  return headings
}

const Editor = forwardRef(function Editor(
  { initialContent, onContentChange, onHeadingsChange, onSave },
  ref
) {
  const isSettingContent = useRef(false)
  const [editMode, setEditMode] = useState('wysiwyg') // 'wysiwyg' | 'raw'
  const [rawContent, setRawContent] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { languageClassPrefix: 'language-' } }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'md-table' } }),
      TableRow,
      TableHeader,
      TableCell.configure({ HTMLAttributes: { style: 'min-width: 80px' } }),
      Placeholder.configure({ placeholder: '여기에 마크다운을 작성하세요…' }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: '-',
        transformPastedText: true,
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return
      const markdown = editor.storage.markdown.getMarkdown()
      onContentChange(markdown, countWords(editor.getText()))
      onHeadingsChange?.(extractHeadings(editor))
    },
    onSelectionUpdate: () => setTick(t => t + 1),
  })

  const [, setTick] = useState(0)

  useImperativeHandle(ref, () => ({
    scrollToPos: (pos) => {
      if (!editor) return
      editor.commands.setTextSelection(pos)
      editor.commands.focus()
      editor.commands.scrollIntoView()
    },
  }), [editor])

  // Load initial content on mount
  useEffect(() => {
    if (!editor) return
    isSettingContent.current = true
    editor.commands.setContent(initialContent || '')
    const t = setTimeout(() => {
      isSettingContent.current = false
      onHeadingsChange?.(extractHeadings(editor))
    }, 60)
    return () => clearTimeout(t)
  }, [editor])

  // ── Mode switching ─────────────────────────────────────────
  const switchToRaw = useCallback(() => {
    if (!editor) return
    const md = editor.storage.markdown.getMarkdown()
    setRawContent(md)
    setEditMode('raw')
  }, [editor])

  const switchToWysiwyg = useCallback(() => {
    if (!editor) return
    isSettingContent.current = true
    editor.commands.setContent(rawContent)
    setTimeout(() => {
      isSettingContent.current = false
      onHeadingsChange?.(extractHeadings(editor))
      onContentChange(rawContent, countWords(rawContent))
    }, 60)
    setEditMode('wysiwyg')
  }, [editor, rawContent, onHeadingsChange, onContentChange])

  const handleNormalize = useCallback(() => {
    const md = editMode === 'wysiwyg'
      ? editor.storage.markdown.getMarkdown()
      : rawContent

    const count = (md.match(/<table[\s\S]*?<\/table>/gi) || []).length
    if (count === 0) {
      alert('변환할 HTML 테이블이 없습니다.')
      return
    }

    const normalized = normalizeHtmlTables(md)

    if (editMode === 'wysiwyg') {
      isSettingContent.current = true
      editor.commands.setContent(normalized)
      setTimeout(() => {
        isSettingContent.current = false
        onContentChange(normalized, countWords(normalized))
        onHeadingsChange?.(extractHeadings(editor))
      }, 60)
    } else {
      setRawContent(normalized)
      onContentChange(normalized, countWords(normalized))
    }
  }, [editMode, editor, rawContent, onContentChange, onHeadingsChange])

  const handleRawChange = useCallback((e) => {
    const val = e.target.value
    setRawContent(val)
    onContentChange(val, countWords(val))
  }, [onContentChange])

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
      e.preventDefault()
      onSave()
    }
  }, [onSave])

  if (!editor) return null

  return (
    <div className="editor-wrapper" onKeyDown={editMode === 'wysiwyg' ? handleKeyDown : undefined}>
      {/* ── Mode toggle bar ── */}
      <div className="mode-bar">
        <div className="mode-toggle">
          <button
            className={`mode-btn ${editMode === 'wysiwyg' ? 'active' : ''}`}
            onClick={() => editMode === 'raw' && switchToWysiwyg()}
            title="WYSIWYG 편집 모드"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            편집
          </button>
          <button
            className={`mode-btn ${editMode === 'raw' ? 'active' : ''}`}
            onClick={() => editMode === 'wysiwyg' && switchToRaw()}
            title="Raw 마크다운 편집 모드"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            Raw
          </button>
        </div>

        <button
          className="normalize-btn"
          onClick={handleNormalize}
          title="파일 내 HTML 테이블을 Markdown 표로 일괄 변환"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="17 1 21 5 17 9"/>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
          HTML → MD
        </button>
      </div>

      {/* ── WYSIWYG mode ── */}
      {editMode === 'wysiwyg' && <Toolbar editor={editor} />}
      {editMode === 'wysiwyg' && <SelectionInfo editor={editor} />}
      {editMode === 'wysiwyg' && (
        <div className="editor-scroll">
          <EditorContent editor={editor} className="editor-content" />
        </div>
      )}

      {/* ── Raw mode ── */}
      {editMode === 'raw' && (
        <div className="editor-scroll raw-scroll">
          <textarea
            className="raw-editor"
            value={rawContent}
            onChange={handleRawChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoFocus
          />
        </div>
      )}
    </div>
  )
})

export default Editor
