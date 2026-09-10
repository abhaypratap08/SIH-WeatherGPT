import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Java backend (Spring Boot)
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // Python ML backend (FastAPI — LangChain agent + route weather)
      '/agent': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/route-weather': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
