import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { boot } from './vite/bootPlugin';

export default defineConfig({
  plugins: [react(), boot()],
  build: {
    // MapLibre alone is ~1 MB minified; keep it in its own long-cached chunk.
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
