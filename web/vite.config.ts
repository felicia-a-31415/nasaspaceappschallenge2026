import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

/**
 * The 20 MB sample lives in public/ so the dev server can serve it, which means Vite
 * would copy it into every build. The real page reads the hotspots from the server.
 */
function dropMockData(): Plugin {
  return {
    name: 'drop-mock-data',
    apply: 'build',
    closeBundle() {
      rmSync(resolve(__dirname, 'dist/mock'), { recursive: true, force: true })
    },
  }
}

// The page always calls /api/... with no host name. In development that is proxied to
// the FastAPI server; in production the server serves the built page from the same origin.
export default defineConfig({
  plugins: [react(), dropMockData()],
  // Read .env from the repo root, next to the server's. Only VITE_ names reach the page.
  envDir: '..',
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
