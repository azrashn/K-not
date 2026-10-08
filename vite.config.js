import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// Tarayıcı yalnızca NestJS ile konuşur. Geliştirmede /api → NestJS (aynı köken, CORS gerekmez).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_PROXY_TARGET || 'http://localhost:3000'
  const proxy = { '/api': { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } }
  return {
    plugins: [react(), tailwindcss()],
    oxc: { jsx: { runtime: 'automatic' } },
    esbuild: { jsx: 'automatic' }, // Vitest 3 bundles its own esbuild-based Vite
    server: { proxy },
    preview: { proxy },
    test: {
      environment: 'jsdom',
      include: ['tests/frontend/**/*.test.{js,jsx}'],
      setupFiles: ['tests/frontend/setup.js'],
      restoreMocks: true,
    },
  }
})
