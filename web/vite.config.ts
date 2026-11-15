import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The page always calls /api/... with no host name. In development that is proxied to
// the FastAPI server; in production the server serves the built page from the same origin.
export default defineConfig({
  plugins: [react()],
  // MapLibre ships its own web worker; Vite's dependency pre-bundling cannot serve it.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
})
