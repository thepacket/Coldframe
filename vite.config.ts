import { defineConfig } from 'vite';

// Locus artifacts are served straight out of data/derived. In dev that means
// the full artifact, genotypes included. A production build copies whatever is
// in there into dist/, which is why `npm run build` runs check-publishable
// first - see scripts/check-publishable.mjs and data-sources.json.
export default defineConfig({
  publicDir: 'data/derived',
  build: { outDir: 'dist', emptyOutDir: true },
});
