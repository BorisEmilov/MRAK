import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { demoPlugin } from './build/demo-plugin';
import { inkPlugin } from './build/ink-plugin';

export default defineConfig({
  plugins: [demoPlugin(), react(), inkPlugin()],
  server: { port: 5173 },
  build: {
    target: 'es2023',
    // Vite's hashed code goes to /app; generated game assets live in /assets (see public/_headers).
    assetsDir: 'app',
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'phaser', test: /node_modules[\\/]phaser/ }] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
