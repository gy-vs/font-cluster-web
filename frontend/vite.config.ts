import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev the API is served by FastAPI on :8000; proxy /api so the
// frontend can use same-origin relative URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/sample/': 'http://127.0.0.1:8000'
    }
  }
})
