import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PUBLIC_URL = '/lobby';

export default defineConfig({
  base: PUBLIC_URL,
  define: {
    'process.env.PUBLIC_URL': JSON.stringify(PUBLIC_URL)
  },
  plugins: [react()],
  build: {
    outDir: 'lobby',
    sourcemap: false
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});