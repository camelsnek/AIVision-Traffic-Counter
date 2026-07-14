import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// COOP/COEP make the page cross-origin isolated, which unlocks
// SharedArrayBuffer and therefore multithreaded WASM inference.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: {
    // The transformers.js chunk is large by nature; silence the size nag.
    chunkSizeWarningLimit: 2200,
  },
})
