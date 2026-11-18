import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Development: the UI on localhost:5174 talks to studio-api on localhost:3100 (loopback only).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, host: '127.0.0.1', proxy: { '/v1': 'http://127.0.0.1:3100' } },
  build: { target: 'es2023' },
});
