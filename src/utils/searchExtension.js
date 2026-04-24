import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const searchPluginKey = new PluginKey('searchHighlight')

function findMatches(doc, term) {
  if (!term) return []
  const results = []
  const lowerTerm = term.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const lowerText = node.text.toLowerCase()
    let i = 0
    while ((i = lowerText.indexOf(lowerTerm, i)) !== -1) {
      results.push({ from: pos + i, to: pos + i + term.length })
      i += term.length
    }
  })
  return results
}

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addCommands() {
    return {
      setSearchTerm: (term) => ({ tr, dispatch, state }) => {
        const results = term ? findMatches(state.doc, term) : []
        tr.setMeta(searchPluginKey, { type: 'set', term, resultIndex: 0, precomputed: results })
        if (results.length > 0) {
          const first = results[0]
          tr.setSelection(TextSelection.create(state.doc, first.from, first.to))
          tr.scrollIntoView()
        }
        if (dispatch) dispatch(tr)
        return true
      },

      nextSearchResult: () => ({ tr, dispatch, state }) => {
        const ps = searchPluginKey.getState(state)
        if (!ps?.results?.length) return false
        const nextIdx = (ps.resultIndex + 1) % ps.results.length
        const match = ps.results[nextIdx]
        if (dispatch) {
          const sel = TextSelection.create(state.doc, match.from, match.to)
          dispatch(
            tr
              .setMeta(searchPluginKey, { type: 'setIndex', resultIndex: nextIdx })
              .setSelection(sel)
              .scrollIntoView()
          )
        }
        return true
      },

      previousSearchResult: () => ({ tr, dispatch, state }) => {
        const ps = searchPluginKey.getState(state)
        if (!ps?.results?.length) return false
        const prevIdx = (ps.resultIndex - 1 + ps.results.length) % ps.results.length
        const match = ps.results[prevIdx]
        if (dispatch) {
          const sel = TextSelection.create(state.doc, match.from, match.to)
          dispatch(
            tr
              .setMeta(searchPluginKey, { type: 'setIndex', resultIndex: prevIdx })
              .setSelection(sel)
              .scrollIntoView()
          )
        }
        return true
      },

      replaceCurrentResult: (replaceTerm) => ({ tr, dispatch, state }) => {
        const ps = searchPluginKey.getState(state)
        if (!ps?.results?.length) return false
        const match = ps.results[ps.resultIndex]
        if (replaceTerm) {
          tr.replaceWith(match.from, match.to, state.schema.text(replaceTerm))
        } else {
          tr.delete(match.from, match.to)
        }
        const newResults = findMatches(tr.doc, ps.term)
        const newIdx = Math.min(ps.resultIndex, Math.max(0, newResults.length - 1))
        tr.setMeta(searchPluginKey, { type: 'set', term: ps.term, resultIndex: newIdx, precomputed: newResults })
        if (newResults.length > 0) {
          const nextMatch = newResults[newIdx]
          tr.setSelection(TextSelection.create(tr.doc, nextMatch.from, nextMatch.to))
          tr.scrollIntoView()
        }
        if (dispatch) dispatch(tr)
        return true
      },

      replaceAllResults: (replaceTerm) => ({ tr, dispatch, state }) => {
        const ps = searchPluginKey.getState(state)
        if (!ps?.results?.length) return false
        const sorted = [...ps.results].sort((a, b) => b.from - a.from)
        for (const { from, to } of sorted) {
          if (replaceTerm) {
            tr.replaceWith(from, to, state.schema.text(replaceTerm))
          } else {
            tr.delete(from, to)
          }
        }
        const newResults = findMatches(tr.doc, ps.term)
        tr.setMeta(searchPluginKey, { type: 'set', term: ps.term, resultIndex: 0, precomputed: newResults })
        if (dispatch) dispatch(tr)
        return true
      },

      clearSearch: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(searchPluginKey, { type: 'clear' }))
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: searchPluginKey,
      state: {
        init: () => ({ term: '', results: [], resultIndex: 0 }),
        apply(tr, pluginState, _, newDocState) {
          const meta = tr.getMeta(searchPluginKey)
          if (meta) {
            if (meta.type === 'clear') return { term: '', results: [], resultIndex: 0 }
            if (meta.type === 'set') {
              const results = meta.precomputed ?? findMatches(newDocState.doc, meta.term)
              return { term: meta.term, results, resultIndex: meta.resultIndex ?? 0 }
            }
            if (meta.type === 'setIndex') {
              return { ...pluginState, resultIndex: meta.resultIndex }
            }
          }
          if (tr.docChanged && pluginState.term) {
            const results = findMatches(newDocState.doc, pluginState.term)
            const resultIndex = Math.min(pluginState.resultIndex, Math.max(0, results.length - 1))
            return { ...pluginState, results, resultIndex }
          }
          return pluginState
        },
      },
      props: {
        decorations(state) {
          const ps = searchPluginKey.getState(state)
          if (!ps?.term) return DecorationSet.empty
          const decos = ps.results.map((r, i) =>
            Decoration.inline(r.from, r.to, {
              class: i === ps.resultIndex
                ? 'search-result search-result-current'
                : 'search-result',
            })
          )
          return DecorationSet.create(state.doc, decos)
        },
      },
    })]
  },
})
