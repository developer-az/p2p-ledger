import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { assistantApiPlugin } from './vite-plugin-api.js';

export default defineConfig({
  plugins: [react(), assistantApiPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
        },
      },
    },
    chunkSizeWarningLimit: 300,
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
