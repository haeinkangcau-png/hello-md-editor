import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  // Tauri runs its own terminal UI; don't let Vite wipe it.
  clearScreen: false,
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      // Don't watch build output / native build artifacts.
      ignored: ['**/release/**', '**/src-tauri/**'],
    },
  },
})
