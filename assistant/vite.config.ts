import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { assistantApiPlugin } from './vite-plugin-api.js';

export default defineConfig({
  plugins: [react(), assistantApiPlugin()],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
