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
    // Re-render SelectionInfo on every cursor move
    onSelectionUpdate: () => setTick(t => t + 1),
  })

  // Tick counter to force re-render when selection changes
  // (editor object reference is stable, so we need this)
  const [, setTick] = useState(0)

  // Expose scrollToPos via ref
  useImperativeHandle(ref, () => ({
    scrollToPos: (pos) => {
      if (!editor) return
      editor.commands.setTextSelection(pos)
      editor.commands.focus()
      editor.commands.scrollIntoView()
    },
  }), [editor])

  // Load initial content on mount (key resets per file)
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

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
      e.preventDefault()
      onSave()
    }
  }, [onSave])

  if (!editor) return null

  return (
    <div className="editor-wrapper" onKeyDown={handleKeyDown}>
      <Toolbar editor={editor} />
      <SelectionInfo editor={editor} />
      <div className="editor-scroll">
        <EditorContent editor={editor} className="editor-content" />
      </div>
    </div>
  )
})

export default Editor
