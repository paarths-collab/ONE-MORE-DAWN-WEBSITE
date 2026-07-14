import { defineConfig } from 'vite';
import { devvit } from '@devvit/start/vite';

export default defineConfig({
  plugins: [
    devvit({
      client: {
        build: {
          chunkSizeWarningLimit: 2000,
          // Don't ship source maps to end users — they inflate the upload by
          // ~3.4MB and expose the full client source.
          sourcemap: false,
        },
      },
    }),
  ],
});
