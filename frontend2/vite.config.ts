import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      // Python AI backend (ML/main.py at :8000)
      '/agent': { target: 'http://localhost:8000', changeOrigin: true },
      '/route-weather': { target: 'http://localhost:8000', changeOrigin: true },
      // Java backend (:8080) for weather/climate/alerts endpoints
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
