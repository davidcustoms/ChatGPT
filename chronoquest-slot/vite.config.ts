import { defineConfig } from 'vite';

// Vite + Vitest shared configuration.
// Vitest reads the `test` block; the rest applies to the dev/build pipeline.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
