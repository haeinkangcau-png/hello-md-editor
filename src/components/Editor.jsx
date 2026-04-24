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
import SearchBar from './SearchBar'
import { normalizeHtmlTables } from '../utils/mdRenderer'
import { SearchHighlight, searchPluginKey } from '../utils/searchExtension'

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
  const headingDebounceRef = useRef(null)
  const [editMode, setEditMode] = useState('wysiwyg') // 'wysiwyg' | 'raw'
  const [rawContent, setRawContent] = useState('')
  const [copied, setCopied] = useState(false)

  // ── Search state ───────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [matchCount, setMatchCount] = useState(0)
  const [resultIndex, setResultIndex] = useState(0)
  // Raw-mode only: matches are {start, end} indices in rawContent
  const [rawMatches, setRawMatches] = useState([])
  const [rawMatchIdx, setRawMatchIdx] = useState(0)
  const textareaRef = useRef(null)

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
      SearchHighlight,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return
      const markdown = editor.storage.markdown.getMarkdown()
      onContentChange(markdown, countWords(editor.getText()))
      // Debounce heading extraction — no need to traverse the full doc on every keystroke
      clearTimeout(headingDebounceRef.current)
      headingDebounceRef.current = setTimeout(() => {
        onHeadingsChange?.(extractHeadings(editor))
      }, 300)
    },
  })

  useImperativeHandle(ref, () => ({
    scrollToPos: (pos) => {
      if (!editor) return
      editor.commands.setTextSelection(pos + 1)
      editor.view.focus()
      requestAnimationFrame(() => {
        const domNode = editor.view.nodeDOM(pos)
        if (!domNode) return
        const el = domNode instanceof Element ? domNode : domNode.parentElement
        if (!el) return
        const scrollEl = el.closest('.editor-scroll')
        if (!scrollEl) return
        const offset = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top
        scrollEl.scrollBy({ top: offset, behavior: 'smooth' })
      })
    },
    openSearch: () => {
      setSearchOpen(true)
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

  const scrollToEditorSelection = useCallback(() => {
    if (!editor) return
    requestAnimationFrame(() => {
      try {
        const { from } = editor.state.selection
        const coords = editor.view.coordsAtPos(from)
        const scrollEl = editor.view.dom.closest('.editor-scroll')
        if (!scrollEl) return
        const scrollRect = scrollEl.getBoundingClientRect()
        const relTop = coords.top - scrollRect.top + scrollEl.scrollTop
        scrollEl.scrollTo({ top: relTop - scrollEl.clientHeight / 2, behavior: 'smooth' })
      } catch (_) {}
    })
  }, [editor])

  // ── Sync WYSIWYG search term with plugin ───────────────────
  useEffect(() => {
    if (!editor || editMode !== 'wysiwyg') return
    if (!query) {
      editor.commands.clearSearch()
      setMatchCount(0)
      setResultIndex(0)
      return
    }
    editor.commands.setSearchTerm(query)
    // Read plugin state synchronously after dispatch
    const ps = searchPluginKey.getState(editor.state)
    setMatchCount(ps?.results?.length ?? 0)
    setResultIndex(ps?.resultIndex ?? 0)
    scrollToEditorSelection()
  }, [query, editor, editMode, scrollToEditorSelection])

  // ── Raw mode: compute match positions ──────────────────────
  useEffect(() => {
    if (editMode !== 'raw' || !query) {
      setRawMatches([])
      setRawMatchIdx(0)
      return
    }
    const lowerContent = rawContent.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const matches = []
    let i = 0
    while ((i = lowerContent.indexOf(lowerQuery, i)) !== -1) {
      matches.push({ start: i, end: i + query.length })
      i += query.length
    }
    setRawMatches(matches)
    setRawMatchIdx(0)
  }, [query, rawContent, editMode])

  // ── Raw mode: highlight current match in textarea ──────────
  useEffect(() => {
    if (editMode !== 'raw' || !rawMatches.length || !textareaRef.current) return
    const match = rawMatches[rawMatchIdx]
    const ta = textareaRef.current
    ta.focus()
    ta.setSelectionRange(match.start, match.end)
    // Scroll match into view
    const lines = rawContent.substring(0, match.start).split('\n')
    const lineNum = lines.length - 1
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24
    ta.scrollTop = Math.max(0, lineNum * lineHeight - ta.clientHeight / 2)
  }, [rawMatchIdx, rawMatches, editMode])

  // ── Mode switching ─────────────────────────────────────────
  const switchToRaw = useCallback(() => {
    if (!editor) return
    const md = editor.storage.markdown.getMarkdown()
    setRawContent(md)
    setEditMode('raw')
    // Clear WYSIWYG search highlights
    editor.commands.clearSearch()
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

  const handleCopyAll = useCallback(async () => {
    const md = editMode === 'wysiwyg'
      ? editor.storage.markdown.getMarkdown()
      : rawContent
    try {
      await navigator.clipboard.writeText(md)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* silent */ }
  }, [editMode, editor, rawContent])

  const handleRawChange = useCallback((e) => {
    const val = e.target.value
    setRawContent(val)
    onContentChange(val, countWords(val))
  }, [onContentChange])

  // ── Search handlers ────────────────────────────────────────
  const handleSearchClose = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
    setReplaceText('')
    setShowReplace(false)
    if (editor) editor.commands.clearSearch()
  }, [editor])

  const syncWysiwygSearchState = useCallback(() => {
    if (!editor) return
    const ps = searchPluginKey.getState(editor.state)
    setMatchCount(ps?.results?.length ?? 0)
    setResultIndex(ps?.resultIndex ?? 0)
  }, [editor])

  const handleNext = useCallback(() => {
    if (editMode === 'wysiwyg') {
      editor?.commands.nextSearchResult()
      syncWysiwygSearchState()
      scrollToEditorSelection()
    } else {
      setRawMatchIdx(i => rawMatches.length ? (i + 1) % rawMatches.length : 0)
    }
  }, [editMode, editor, rawMatches, syncWysiwygSearchState, scrollToEditorSelection])

  const handlePrev = useCallback(() => {
    if (editMode === 'wysiwyg') {
      editor?.commands.previousSearchResult()
      syncWysiwygSearchState()
      scrollToEditorSelection()
    } else {
      setRawMatchIdx(i => rawMatches.length ? (i - 1 + rawMatches.length) % rawMatches.length : 0)
    }
  }, [editMode, editor, rawMatches, syncWysiwygSearchState, scrollToEditorSelection])

  const handleReplace = useCallback(() => {
    if (editMode === 'wysiwyg') {
      editor?.commands.replaceCurrentResult(replaceText)
      syncWysiwygSearchState()
    } else {
      if (!rawMatches.length) return
      const match = rawMatches[rawMatchIdx]
      const newContent = rawContent.slice(0, match.start) + replaceText + rawContent.slice(match.end)
      setRawContent(newContent)
      onContentChange(newContent, countWords(newContent))
      // Matches will recompute via useEffect
    }
  }, [editMode, editor, replaceText, rawMatches, rawMatchIdx, rawContent, onContentChange, syncWysiwygSearchState])

  const handleReplaceAll = useCallback(() => {
    if (editMode === 'wysiwyg') {
      editor?.commands.replaceAllResults(replaceText)
      syncWysiwygSearchState()
    } else {
      if (!query) return
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const newContent = rawContent.replace(new RegExp(escaped, 'gi'), replaceText)
      setRawContent(newContent)
      onContentChange(newContent, countWords(newContent))
    }
  }, [editMode, editor, replaceText, query, rawContent, onContentChange, syncWysiwygSearchState])

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
      e.preventDefault()
      onSave()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }, [onSave])

  if (!editor) return null

  // Compute display values from React state (reliable, no timing issues)
  const displayMatchCount = editMode === 'wysiwyg' ? matchCount : rawMatches.length
  const displayCurrentMatch = displayMatchCount === 0 ? 0
    : editMode === 'wysiwyg'
      ? resultIndex + 1
      : rawMatchIdx + 1

  return (
    <div className="editor-wrapper" onKeyDown={handleKeyDown}>
      {/* ── Search bar ── */}
      {searchOpen && (
        <SearchBar
          query={query}
          onQueryChange={setQuery}
          replaceText={replaceText}
          onReplaceTextChange={setReplaceText}
          showReplace={showReplace}
          onToggleReplace={() => setShowReplace(v => !v)}
          matchCount={displayMatchCount}
          currentMatch={displayCurrentMatch}
          onNext={handleNext}
          onPrev={handlePrev}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
          onClose={handleSearchClose}
        />
      )}

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

        <div className="mode-bar-right">
          <button
            className="copy-md-btn"
            onClick={handleCopyAll}
            title="전체 내용을 Markdown으로 클립보드에 복사"
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                복사됨
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                MD 복사
              </>
            )}
          </button>
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
            ref={textareaRef}
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
