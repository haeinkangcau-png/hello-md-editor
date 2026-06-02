import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/hello-md-editor/' : './',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ['**/release/**'],
    },
  },
})
