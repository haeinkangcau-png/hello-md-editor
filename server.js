const express = require('express')
const fs = require('fs')
const path = require('path')
const cors = require('cors')

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

function safeReadDir(dirPath) {
  const entries = fs.readdirSync(dirPath)
  return entries
    .map(name => {
      const fullPath = path.join(dirPath, name)
      try {
        const stat = fs.statSync(fullPath)
        const isDir = stat.isDirectory()
        if (isDir || name.endsWith('.md')) {
          return { name, path: fullPath, isDirectory: isDir }
        }
        return null
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

// List directory contents (shallow)
app.get('/api/files', (req, res) => {
  const dirPath = req.query.dir
  if (!dirPath) return res.status(400).json({ error: 'dir parameter required' })

  try {
    const resolved = path.resolve(dirPath)
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Directory not found' })
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' })

    const items = safeReadDir(resolved)
    res.json({ items, dir: resolved })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Read file content
app.get('/api/file', (req, res) => {
  const filePath = req.query.path
  if (!filePath) return res.status(400).json({ error: 'path parameter required' })

  try {
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' })
    const content = fs.readFileSync(resolved, 'utf-8')
    res.json({ content, path: resolved })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Write file content
app.post('/api/file', (req, res) => {
  const { path: filePath, content } = req.body
  if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content required' })

  try {
    const resolved = path.resolve(filePath)
    const dir = path.dirname(resolved)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(resolved, content, 'utf-8')
    res.json({ success: true, path: resolved })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Check if path exists (for Save As validation)
app.get('/api/exists', (req, res) => {
  const filePath = req.query.path
  if (!filePath) return res.status(400).json({ error: 'path required' })
  res.json({ exists: fs.existsSync(path.resolve(filePath)) })
})

app.listen(PORT, () => {
  console.log(`MD Viewer API → http://localhost:${PORT}`)
})
