import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the UI runs on Vite and talks to the Python engine
// (`aivision serve`, port 8000) through this proxy. In production the
// engine serves the built files itself, so no proxy is involved.
const engine = process.env.AIVISION_ENGINE_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: engine, ws: true, changeOrigin: true },
    },
  },
})
