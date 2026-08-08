import { defineConfig } from 'vite';

// No publicDir: the app ships no data at all. Every source is fetched by the
// visitor's browser from its origin archive and computed locally - see
// src/data/loader.ts.
export default defineConfig({
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: true },
});
