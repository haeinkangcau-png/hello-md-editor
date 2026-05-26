import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',   // Required for Electron production builds (file:// protocol)
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ['**/release/**'],
    },
  },
})
