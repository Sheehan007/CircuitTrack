import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  base: './',
  // the code editor (Monaco) is one large chunk, loaded only when the Code tab first opens
  build: { chunkSizeWarningLimit: 4500 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
