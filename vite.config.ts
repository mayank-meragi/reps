import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base must match the repo name for GitHub Pages project sites
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/reps/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
