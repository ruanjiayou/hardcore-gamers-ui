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
    allowedHosts: ["max.local", "game.jiayou.work","max.local:5173"],
    proxy: {
      '/api': {
        target: 'http://100.125.39.89:8087',
        changeOrigin: true
      },
      // 语音包音频由后端从 server/public/audio 静态托管，dev 下必须转发，否则 /audio/* 打到 Vite
      '/audio': {
        target: 'http://100.125.39.89:8087',
        changeOrigin: true
      },
      // 皮肤图同理：server/public/skins/<pack>/<game>/...
      '/skins': {
        target: 'http://100.125.39.89:8087',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://100.125.39.89:8087', // socket.io 后端
        ws: true,                        // ⚠️ 关键：启用 WebSocket
        changeOrigin: true,
      }
    }
  }
});