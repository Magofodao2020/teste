import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: false, chunkSizeWarningLimit: 600 },
  test: { environment: 'jsdom', globals: true, include: ['tests/unit/**/*.test.ts'] },
});
