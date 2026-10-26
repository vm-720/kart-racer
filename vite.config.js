import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the build works from any folder, including GitHub Pages.
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
});
