import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // CodeMirror + Emmet — ожидаемо крупный, но единственный бандл.
    chunkSizeWarningLimit: 700,
  },
});
