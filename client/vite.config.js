import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The deployed app serves the client and the API from one Vercel domain, so
// the API base URL is just '/api' (see src/api/client.js) and no build-time
// env var is needed. This dev proxy makes that same relative path work locally,
// where Vite and Express are on separate ports.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:4200',
        changeOrigin: true,
      },
    },
  },
})
